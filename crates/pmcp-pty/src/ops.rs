use super::Daemon;
use crate::delivery::Ctx;
use crate::error::{Code, Fail};
use crate::fixtures::record;
use crate::proto::{Expect, TurnReq, WriteReq};
use crate::signals::{KINDS, Shared};
use crate::turn::turn;
use crate::write::{Input, write};
use serde_json::{Value, json};
use std::collections::BTreeMap;

impl Daemon {
    pub(super) fn list(&self, want: &BTreeMap<String, String>) -> Value {
        let sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        let items: Vec<Value> = sessions
            .iter()
            .filter(|s| want.iter().all(|(k, v)| s.labels.get(k) == Some(v)))
            .map(|s| json!({ "id": s.id, "name": s.name, "argv": s.argv, "profile": s.profile.name, "pid": s.pid, "alive": s.term().exit.is_none(), "labels": s.labels }))
            .collect();
        json!({ "ok": true, "instance": self.instance, "sessions": items })
    }

    // An exited session's channel dir (sockets, helper.log) stays for a look until it is removed.
    pub(super) fn remove_op(&self, id: &str) -> Result<Value, Fail> {
        let s = self.find(id)?;
        if s.term().exit.is_none() {
            let message = format!("session {} is still running; kill it first", s.id);
            return Err(Fail::new(Code::Conflict, message));
        }
        self.sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .retain(|x| x.id != s.id);
        let _ = std::fs::remove_dir_all(self.instance_dir().join(&s.id));
        Ok(json!({ "ok": true }))
    }

    pub(super) fn write(&self, w: WriteReq) -> Result<Value, Fail> {
        let s = self.input_target(&w.id, w.expect.as_ref())?;
        let input = Input {
            text: &w.text,
            submit: w.submit,
            guard: w.guard,
            wait_ms: w.wait_ms.unwrap_or(1000),
        };
        write(&s, input).map_err(|e| Fail::new(Code::Exited, e))
    }

    // A session's signals live as long as the daemon knows the session, so a hook event that
    // arrives between turns still marks its hooks as live for the next one.
    pub(super) fn signals_of(&self, id: &str) -> Shared {
        let mut map = self.signals.lock().unwrap_or_else(|e| e.into_inner());
        map.entry(id.to_string()).or_default().clone()
    }

    // With no session from the caller, the one the runtime's hooks reported is the target; with
    // neither, structured channels decline and the screen opens the TUI's own conversation.
    pub(super) fn turn_op(&self, mut r: TurnReq) -> Result<Value, Fail> {
        let s = self.input_target(&r.id, r.expect.as_ref())?;
        let channel = {
            let channels = self.channels.lock().unwrap_or_else(|e| e.into_inner());
            channels.get(&s.id).cloned()
        };
        let signals = self.signals_of(&s.id);
        let learned = signals
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .runtime_session
            .clone();
        let target = r.target.get_or_insert_with(Default::default);
        if target.session.is_none() {
            target.session = learned;
        }
        let ctx = Ctx {
            channel,
            home: std::env::var("HOME").ok(),
            signals,
            ..Ctx::default()
        };
        turn(&s, &self.instance, r, ctx)
    }

    pub(super) fn event_op(
        &self,
        id: &str,
        kind: &str,
        message: Option<String>,
        session: Option<String>,
        expect: Option<&Expect>,
    ) -> Result<Value, Fail> {
        if !KINDS.contains(&kind) {
            let message = format!("unknown event {kind}; one of {}", KINDS.join(", "));
            return Err(Fail::new(Code::BadRequest, message));
        }
        let s = self.target(id, expect)?;
        let signals = self.signals_of(&s.id);
        let seq = signals
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .hook(kind, message, session);
        Ok(json!({ "ok": true, "seq": seq }))
    }

    pub(super) fn record_op(&self, id: &str, label: &str, redact: bool) -> Result<Value, Fail> {
        let root = self.fixtures.as_ref().ok_or_else(|| {
            Fail::new(
                Code::BadRequest,
                "start the daemon with --fixtures to record",
            )
        })?;
        let s = self.find(id)?;
        let version = s.term().version.clone();
        record(root, &s, label, version, redact)
    }
}
