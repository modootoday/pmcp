use crate::attachers::Registry;
use crate::audit::Audit;
use crate::channel::Channel;
use crate::error::{Code, Fail};
use crate::input;
use crate::lease::Leases;
use crate::observe::observe;
use crate::profile::ProfileSet;
use crate::proto::{Expect, Request};
use crate::ring::strip_ansi;
use crate::session::Session;
use crate::signals::Shared;
use crate::views::{screen, state};
use crate::wait::wait;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicU64;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

#[path = "spawn.rs"]
mod spawn;

#[path = "ops.rs"]
mod ops;

#[path = "answer.rs"]
mod answer;

#[path = "describe.rs"]
mod describe;

const READ_DEFAULT_CHARS: usize = 16_000;

pub struct Daemon {
    sessions: Mutex<Vec<Arc<Session>>>,
    profiles: ProfileSet,
    next_id: AtomicU64,
    // Daemon pid and start time: session ids restart at s1 after a restart, the instance does not.
    pub instance: String,
    socket: String,
    // Fixed at daemon start, so a request can never choose where record writes.
    fixtures: Option<PathBuf>,
    // The delivery channel each session was launched with (delivery_setup), by session id.
    channels: Mutex<HashMap<String, Channel>>,
    // Turn signals from each session's hooks and channel, by session id.
    signals: Mutex<HashMap<String, Shared>>,
    pub attached: Registry,
    pub audit: Audit,
    pub(crate) leases: Leases,
    // The operator's policy, fixed at daemon start like fixtures.
    policy: crate::policy::Source,
}

/// What the daemon is started with besides its profiles; requests can change none of it.
#[derive(Default)]
pub struct Config {
    pub fixtures: Option<PathBuf>,
    pub policy: crate::policy::Source,
}

fn exited(e: String) -> Fail {
    Fail::new(Code::Exited, e)
}

impl Daemon {
    pub fn new(profiles: ProfileSet, socket: String, config: Config) -> Daemon {
        let started = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        Daemon {
            sessions: Mutex::new(Vec::new()),
            profiles,
            next_id: AtomicU64::new(1),
            instance: format!("{}-{started}", std::process::id()),
            audit: Audit::open(std::path::Path::new(&socket)),
            socket,
            fixtures: config.fixtures,
            channels: Mutex::new(HashMap::new()),
            signals: Mutex::new(HashMap::new()),
            attached: Registry::new(),
            leases: Leases::default(),
            policy: config.policy,
        }
    }

    pub fn find(&self, key: &str) -> Result<Arc<Session>, Fail> {
        let sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(s) = sessions.iter().find(|s| s.id == key) {
            return Ok(s.clone());
        }
        sessions
            .iter()
            .rev()
            .find(|s| s.name == key)
            .cloned()
            .ok_or_else(|| Fail::new(Code::NotFound, format!("no session {key}")))
    }

    // A mutating request names the session it means, so a reused id never reaches another one.
    fn target(&self, key: &str, expect: Option<&Expect>) -> Result<Arc<Session>, Fail> {
        let s = self.find(key)?;
        let Some(e) = expect else { return Ok(s) };
        if e.instance.as_ref().is_some_and(|i| *i != self.instance) {
            return Err(Fail::new(
                Code::Stale,
                format!("instance is {}", self.instance),
            ));
        }
        if e.pid.is_some() && e.pid != s.pid {
            return Err(Fail::new(
                Code::Stale,
                format!("session {} has pid {:?}", s.id, s.pid),
            ));
        }
        Ok(s)
    }

    // Input that types into the TUI also needs the harness lease, when one is live, and yields
    // to a person who typed through an attach in the last few seconds.
    fn input_target(&self, key: &str, expect: Option<&Expect>) -> Result<Arc<Session>, Fail> {
        let s = self.target(key, expect)?;
        self.leases
            .check(&s.id, expect.and_then(|e| e.lease.as_deref()))?;
        if self.attached.human_typing(&s.id) {
            let mut fail = Fail::new(Code::Conflict, format!("a person is typing in {}", s.id));
            fail.retry_after_ms = Some(crate::attachers::HUMAN_QUIET.as_millis() as u64);
            return Err(fail);
        }
        Ok(s)
    }

    // Shutdown waits for the escalation, so nothing a session started outlives the daemon.
    pub fn kill_all(&self) {
        let sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        // Helpers are siblings of their TUIs, so they are roots of their own.
        let channels = self.channels.lock().unwrap_or_else(|e| e.into_inner());
        let helpers = channels.values().filter_map(|c| c.helper.as_ref());
        #[cfg(unix)]
        {
            let mut roots: Vec<u32> = sessions.iter().filter_map(|s| s.pid).collect();
            roots.extend(helpers.clone().map(|h| h.pid));
            crate::reap::terminate(&roots, crate::reap::GRACE);
        }
        for h in helpers {
            h.stop();
        }
        #[cfg(not(unix))]
        for s in sessions.iter() {
            let _ = s.kill(None);
        }
        let _ = std::fs::remove_dir_all(self.instance_dir());
    }

    /// Handles every request that answers with exactly one line.
    pub fn handle(&self, req: Request) -> Result<Value, Fail> {
        match req {
            Request::Spawn(spec) => self.spawn(spec),
            Request::List { labels } => Ok(self.list(&labels)),
            Request::Screen { id } => Ok(screen(&*self.find(&id)?)),
            Request::Tail { id, bytes, strip } => {
                let raw = self.find(&id)?.term().ring.tail(bytes.unwrap_or(64 * 1024));
                let text = String::from_utf8_lossy(&raw).into_owned();
                let text = match strip {
                    true => strip_ansi(&text),
                    false => text,
                };
                Ok(json!({ "ok": true, "text": text }))
            }
            Request::State { id } => {
                let mut v = state(&*self.find(&id)?);
                v["instance"] = json!(self.instance);
                Ok(v)
            }
            Request::Observe { id, lines } => {
                let s = self.find(&id)?;
                let mut v = observe(&s, &self.instance, lines);
                // Who else drives it: a live harness lease, and people attached with write access.
                v["leased"] = json!(self.leases.leased(&s.id));
                v["humans"] = json!(self.attached.humans(&s.id));
                Ok(v)
            }
            Request::Wait(w) => wait(&*self.find(&w.id)?, &self.instance, w),
            Request::Read {
                id,
                since,
                max_chars,
            } => {
                let s = self.find(&id)?;
                let t = s.settle();
                let page = t
                    .transcript
                    .read(since.unwrap_or(0), max_chars.unwrap_or(READ_DEFAULT_CHARS));
                Ok(
                    json!({ "ok": true, "text": page.text, "next": page.next, "gap": page.gap, "more": page.more }),
                )
            }
            Request::Turn(r) => self.turn_op(r),
            Request::Event {
                id,
                kind,
                message,
                session,
                expect,
            } => self.event_op(&id, &kind, message, session, expect.as_ref()),
            Request::Write(w) => self.write(w),
            Request::Key { id, key, expect } => {
                let s = self.input_target(&id, expect.as_ref())?;
                let app_cursor = s.term().parser.screen().application_cursor();
                s.write_raw(&input::encode_key(&key, app_cursor)?)
                    .map_err(exited)?;
                Ok(json!({ "ok": true }))
            }
            Request::Resize {
                id,
                cols,
                rows,
                expect,
            } => {
                self.target(&id, expect.as_ref())?
                    .resize(cols, rows)
                    .map_err(exited)?;
                Ok(json!({ "ok": true }))
            }
            Request::Kill { id, signal, expect } => {
                self.target(&id, expect.as_ref())?.kill(signal.as_deref())?;
                Ok(json!({ "ok": true }))
            }
            Request::Remove { id } => self.remove_op(&id),
            Request::Attachers { id } => Ok(self.attached.list(&self.find(&id)?.id)),
            Request::Record { id, label, redact } => self.record_op(&id, &label, redact),
            Request::Detach { id } => {
                let detached = self.attached.detach_all(&self.find(&id)?.id);
                Ok(json!({ "ok": true, "detached": detached }))
            }
            Request::Lease(l) => self.leases.set(&self.find(&l.id)?.id, &l),
            Request::Answer(a) => self.answer_op(a),
            Request::Describe => Ok(self.describe()),
            Request::Subscribe { .. } | Request::Attach(_) | Request::Shutdown => Err(Fail::new(
                Code::BadRequest,
                "streaming request reached the one-shot handler",
            )),
        }
    }
}
