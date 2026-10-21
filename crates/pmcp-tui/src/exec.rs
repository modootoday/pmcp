use crate::control::busy;
use crate::events::{Effect, Event, Failure};
use crate::host::PtyHost;
use crate::panels::HISTORY_BYTES;
use crate::summary::safe;
use pmcp_pty::UnixStream;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::mpsc::Sender;

// Carries effects out against pmcp-pty and the pmcp CLI. Requests that may wait run on their own
// thread and answer with an event, so the screen keeps drawing meanwhile.
const LEASE_TTL_MS: u64 = 30_000;

pub struct Mailbox {
    pub pmcp: PathBuf,
    pub config: PathBuf,
    pub actor_file: PathBuf,
}

pub struct Exec {
    pub host: Arc<PtyHost>,
    pub tx: Sender<Event>,
    pub mailbox: Option<Arc<Mailbox>>,
    streams: HashMap<u64, UnixStream>,
}

fn failure(action: &str, reply: &Value) -> Failure {
    let code = reply["code"].as_str().unwrap_or("request_failed");
    let hint = reply["message"]
        .as_str()
        .unwrap_or("pmcp-pty refused the request");
    Failure::new(action, code, hint)
}

fn token() -> String {
    use std::hash::{BuildHasher, RandomState};
    let a = RandomState::new().hash_one(std::process::id());
    let b = RandomState::new().hash_one(std::time::SystemTime::now());
    format!("pmcp-tui-{a:016x}{b:016x}")
}

impl Exec {
    pub fn new(host: Arc<PtyHost>, tx: Sender<Event>, mailbox: Option<Arc<Mailbox>>) -> Exec {
        Exec {
            host,
            tx,
            mailbox,
            streams: HashMap::new(),
        }
    }

    /// Runs one effect; false asks the caller to stop.
    pub fn run(&mut self, effect: Effect) -> bool {
        match effect {
            Effect::Quit => return false,
            Effect::Attach {
                id,
                serial,
                read_only,
                size,
                lease,
            } => {
                match self
                    .host
                    .attach(&id, serial, read_only, size, lease, self.tx.clone())
                {
                    Ok(stream) => {
                        self.streams.insert(serial, stream);
                        if !read_only {
                            let _ = self.tx.send(Event::Writable { serial });
                        }
                    }
                    Err(why) => {
                        let f = Failure::new("attach", "attach_refused", why);
                        let e = if read_only {
                            Event::Failed(f)
                        } else {
                            Event::ControlFailed(f)
                        };
                        let _ = self.tx.send(e);
                    }
                }
            }
            Effect::Detach { serial } => {
                if let Some(s) = self.streams.remove(&serial) {
                    let _ = s.shutdown(std::net::Shutdown::Both);
                }
            }
            Effect::Input { serial, bytes } => {
                let broken = self
                    .streams
                    .get_mut(&serial)
                    .is_some_and(|s| s.write_all(&bytes).is_err());
                if broken {
                    let _ = self.tx.send(Event::Closed { serial });
                }
            }
            other => self.background(other),
        }
        true
    }

    fn background(&self, effect: Effect) {
        let host = self.host.clone();
        let tx = self.tx.clone();
        let mailbox = self.mailbox.clone();
        std::thread::spawn(move || {
            let event = match effect {
                Effect::Acquire { id } => acquire(&host, &id),
                Effect::Renew { id, token } => {
                    let r = host.call(json!({ "op": "lease", "id": id, "token": token, "current": token, "ttl_ms": LEASE_TTL_MS }));
                    match r["ok"] == true {
                        true => return,
                        false => Event::ControlFailed(failure("renew", &r)),
                    }
                }
                Effect::Release { id, token } => {
                    let r = host.call(
                        json!({ "op": "lease", "id": id, "current": token, "release": true }),
                    );
                    match r["ok"] == true {
                        true => Event::Released,
                        false => Event::ReleaseFailed(failure("release", &r)),
                    }
                }
                Effect::ResizePty { id, cols, rows } => {
                    let r =
                        host.call(json!({ "op": "resize", "id": id, "cols": cols, "rows": rows }));
                    match r["ok"] == true {
                        true => return,
                        false => Event::Failed(failure("resize", &r)),
                    }
                }
                Effect::ReadHistory { id } => history(&host, id),
                Effect::ReadMailbox => match mailbox {
                    Some(m) => read_mailbox(&m),
                    None => Event::Mailbox(None),
                },
                _ => return,
            };
            let _ = tx.send(event);
        });
    }
}

// Never during a turn: a person taking over mid-reply would type into whatever the agent drew.
fn acquire(host: &PtyHost, id: &str) -> Event {
    let seen = host.call(json!({ "op": "observe", "id": id, "lines": 0 }));
    if seen["ok"] != true {
        return Event::ControlFailed(failure("control", &seen));
    }
    if let Some(f) = busy(seen["busy"].as_str()) {
        return Event::ControlFailed(f);
    }
    let token = token();
    let r = host.call(json!({ "op": "lease", "id": id, "token": token, "ttl_ms": LEASE_TTL_MS }));
    match r["ok"] == true {
        true => Event::Leased { token },
        false => Event::ControlFailed(failure("control", &r)),
    }
}

fn history(host: &PtyHost, id: String) -> Event {
    let mut text = String::new();
    let mut since = 0;
    loop {
        let page = host
            .call(json!({ "op": "read", "id": id, "since": since, "max_chars": HISTORY_BYTES }));
        if page["ok"] != true {
            return Event::Failed(failure("history", &page));
        }
        if !text.is_empty() {
            text.push('\n');
        }
        text.push_str(page["text"].as_str().unwrap_or_default());
        if text.len() > 2 * HISTORY_BYTES {
            text.drain(..text.len() - HISTORY_BYTES);
            while !text.is_char_boundary(0) {
                text.remove(0);
            }
        }
        since = page["next"].as_u64().unwrap_or(since);
        if page["more"] != true {
            return Event::History { id, text };
        }
    }
}

// The existing mailbox CLI with an observer actor; only ids are kept, never bodies.
fn read_mailbox(m: &Mailbox) -> Event {
    let out = std::process::Command::new(&m.pmcp)
        .arg("mailbox")
        .arg("inbox")
        .arg("--config")
        .arg(&m.config)
        .arg("--actor-file")
        .arg(&m.actor_file)
        .stdin(std::process::Stdio::null())
        .output();
    let reply: Value = match out {
        Ok(o) => serde_json::from_slice(&o.stdout).unwrap_or(Value::Null),
        Err(e) => return Event::Failed(Failure::new("mailbox", "pmcp_unavailable", e.to_string())),
    };
    if reply["ok"] != true {
        let code = reply["error"]["code"].as_str().unwrap_or("mailbox_failed");
        return Event::Failed(Failure::new(
            "mailbox",
            code,
            "pmcp mailbox inbox refused; see the CLI.",
        ));
    }
    let items = reply["data"]["items"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let field = |v: &Value, k: &str| safe(v[k].as_str().unwrap_or("none"));
    let rows = items
        .iter()
        .map(|i| {
            format!(
                "{} thread={} reply={}",
                field(i, "messageId"),
                field(i, "threadId"),
                field(i, "replyToId")
            )
        })
        .collect();
    Event::Mailbox(Some(rows))
}
