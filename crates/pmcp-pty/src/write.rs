use crate::error::{Fail, code_name};
use crate::guard::{self, Observation};
use crate::input;
use crate::proto::Guard;
use crate::session::Session;
use serde_json::{Value, json};
use std::time::Duration;

pub struct Input<'a> {
    pub text: &'a str,
    pub submit: bool,
    pub guard: Guard,
    pub wait_ms: u64,
}

fn refused(fail: Fail) -> Value {
    let mut v = json!({ "ok": true, "accepted": false, "code": code_name(fail.code), "reason": fail.message });
    if let Some(ms) = fail.retry_after_ms {
        v["retry_after_ms"] = json!(ms);
    }
    v
}

fn submit_blocker(guard: Guard, alive: bool, dialog: Option<String>) -> Option<String> {
    if guard == Guard::None {
        return None;
    }
    if !alive {
        return Some("session exited before submit".into());
    }
    dialog.map(|d| format!("dialog appeared before submit: {d}"))
}

// A refusal is a receipt, not an error: the caller asked a fair question and the answer is no.
pub fn write(s: &Session, w: Input) -> Result<Value, String> {
    if w.guard == Guard::Idle {
        let (m, idle_ms, alive) = s.observe();
        let obs = Observation {
            alive,
            idle_ms,
            idle_threshold_ms: s.profile.idle_ms,
            screen: &m,
            composer_missing: s.profile.composer_missing(&m),
        };
        if let Err(fail) = guard::check_idle(&obs) {
            return Ok(refused(fail));
        }
    }
    let (bracketed, before) = {
        let t = s.term();
        (t.parser.screen().bracketed_paste(), t.screen_text())
    };
    let payload = match w.text.is_empty() {
        true => Vec::new(),
        false => match input::encode_text(w.text, bracketed) {
            Ok(bytes) => bytes,
            Err(reason) => return Ok(refused(Fail::from(reason))),
        },
    };
    s.write_raw(&payload)?;
    let mut submitted = false;
    let mut submit_refused = None;
    if w.submit {
        std::thread::sleep(Duration::from_millis(s.profile.submit_delay_ms));
        let (m, _, alive) = s.observe();
        submit_refused = submit_blocker(w.guard, alive, m.dialog);
        if submit_refused.is_none() {
            s.write_raw(b"\r")?;
            submitted = true;
        }
    }
    let changed = s.wait_screen_change(&before, Duration::from_millis(w.wait_ms));
    let paste = match bracketed {
        true => "bracketed",
        false => "raw",
    };
    Ok(json!({
        "ok": true, "accepted": true, "bytes": payload.len(), "paste": paste,
        "submitted": submitted, "submit_refused": submit_refused, "screen_changed_within_ms": changed,
    }))
}
