use super::Daemon;
use crate::channel::prepare;
use crate::error::{Code, Fail};
use crate::helper;
use crate::proto::SpawnReq;
use crate::scrub::markers;
use crate::session::{Session, SpawnSpec};
use crate::version::detect;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;

impl Daemon {
    // Channel sockets and helper logs; a session's part goes with remove, the rest with shutdown.
    pub(super) fn instance_dir(&self) -> PathBuf {
        let base = Path::new(&self.socket)
            .parent()
            .unwrap_or(Path::new("/tmp"));
        base.join("pmcp-pty.d").join(&self.instance)
    }

    pub(super) fn spawn(&self, req: SpawnReq) -> Result<Value, Fail> {
        let argv0 = req.argv.first().cloned().unwrap_or_default();
        let profile = self.profiles.select(req.profile.as_deref(), &argv0)?;
        let id = format!("s{}", self.next_id.fetch_add(1, Ordering::SeqCst));
        let name = req.name.unwrap_or_else(|| id.clone());
        let taken = self
            .find(&name)
            .map(|s| s.term().exit.is_none())
            .unwrap_or(false);
        if taken {
            let message = format!("a live session is already named {name}");
            return Err(Fail::new(Code::Conflict, message));
        }
        let inherited = std::env::vars_os().filter_map(|(k, _)| k.into_string().ok());
        let unset = markers(inherited, &req.keep_env, &req.env);
        // Set after the caller's env, so a spawn request cannot point a session at another host.
        let mut env: Vec<(String, String)> = req.env.into_iter().collect();
        env.push(("PMCP_PTY_SOCKET".into(), self.socket.clone()));
        env.push(("PMCP_PTY_SESSION".into(), id.clone()));
        env.push(("PMCP_PTY_INSTANCE".into(), self.instance.clone()));
        let cwd = req.cwd.clone();
        let delivery = profile.delivery.clone().unwrap_or_else(|| "screen".into());
        let mut argv = req.argv;
        let mut channel = None;
        if req.delivery_setup && delivery != "screen" {
            let dir = self.instance_dir().join(&id);
            let (launch, mut ch, spec) = prepare(&delivery, argv, &env, &dir)?;
            if let Some(spec) = spec {
                ch.helper = Some(helper::start(&spec, &env, &unset, cwd.as_deref())?);
            }
            argv = launch;
            channel = Some(ch);
        }
        let helper_of = channel.as_ref().and_then(|c| c.helper.clone());
        let spawned = Session::spawn(SpawnSpec {
            id: id.clone(),
            name,
            argv,
            cwd: req.cwd,
            env,
            unset: unset.clone(),
            cols: req.cols.unwrap_or(120),
            rows: req.rows.unwrap_or(40),
            ring_bytes: req.ring_kb.unwrap_or(256) * 1024,
            profile: profile.clone(),
            labels: req.labels,
        });
        // A helper whose TUI never started is stopped at once; otherwise it goes with its TUI.
        let session = match (spawned, helper_of) {
            (Err(e), Some(h)) => {
                h.stop();
                return Err(e.into());
            }
            (Err(e), None) => return Err(e.into()),
            (Ok(s), Some(h)) => {
                helper::watch(h, s.clone());
                s
            }
            (Ok(s), None) => s,
        };
        let pid = session.pid;
        // Only a profile that names its version has something to compare, so only then ask.
        if profile.version.is_some() {
            let s = session.clone();
            std::thread::spawn(move || {
                let found = detect(&argv0, cwd.as_deref()).unwrap_or_else(|| "unknown".into());
                s.term().version = Some(found);
            });
        }
        self.sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(session);
        let channel_view = channel.as_ref().map(|c| {
            json!({ "kind": c.kind, "remote": c.remote, "url": c.url, "leader_socket": c.leader_socket })
        });
        if let Some(ch) = channel {
            let mut channels = self.channels.lock().unwrap_or_else(|e| e.into_inner());
            channels.insert(id.clone(), ch);
        }
        // Names only: the values are the spawner's identity and never leave the daemon.
        let reply = json!({ "ok": true, "id": id, "profile": profile.name, "pid": pid, "instance": self.instance, "delivery": delivery, "channel": channel_view, "scrubbed": unset });
        Ok(reply)
    }
}
