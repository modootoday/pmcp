use crate::delivery::{Ctx, Delivered, deliver};
use crate::dialog::parse_dialog;
use crate::error::{Code, Fail};
use crate::observe::snapshot;
use crate::proto::TurnReq;
use crate::session::Session;
use crate::signals::ended;
use serde_json::{Value, json};
use std::time::{Duration, Instant};

const TURN_DEFAULT_MS: u64 = 120_000;
const MAX_MS: u64 = 600_000;
const ECHO_CHARS: usize = 40;
// A session whose hooks report is trusted to report this turn's end too; the screen ends it
// only when they stay silent this long after the screen itself looks finished.
const HOOK_GRACE: Duration = Duration::from_secs(5);

// Lines committed after the echoed input; the first line holding the input is the echo, so a
// reply that quotes the input is still part of the reply.
fn reply_lines(lines: &[String], text: &str) -> Vec<String> {
    let needle: String = text.trim().chars().take(ECHO_CHARS).collect();
    let echo = match needle.is_empty() {
        true => None,
        false => lines.iter().position(|l| l.contains(&needle)),
    };
    let after = echo.map(|i| i + 1).unwrap_or(0);
    lines[after..].to_vec()
}

// A caller that saw idle may arrive while a hook briefly runs; waiting here spares it a retry.
// A dialog or exit ends the wait at once, and delivery then refuses as usual.
fn settle_into_idle(s: &Session, limit: Duration) {
    let start = Instant::now();
    loop {
        let mut t = s.settle();
        let status = snapshot(s, &mut t).status;
        if matches!(status, "idle" | "dialog" | "exited") || start.elapsed() >= limit {
            return;
        }
        let left = limit.saturating_sub(start.elapsed());
        drop(s.wait_changed(t, left.min(Duration::from_millis(100))));
    }
}

struct End {
    outcome: &'static str,
    by: &'static str,
    reply: Option<String>,
    stop_reason: Option<String>,
}

fn end(outcome: &'static str, by: &'static str) -> Option<End> {
    Some(End {
        outcome,
        by,
        reply: None,
        stop_reason: None,
    })
}

// Deliver, then wait for the end: the runtime's hooks first, then the channel, the screen last.
pub fn turn(s: &Session, instance: &str, req: TurnReq, mut ctx: Ctx) -> Result<Value, Fail> {
    let start = Instant::now();
    let deadline = Duration::from_millis(req.timeout_ms.unwrap_or(TURN_DEFAULT_MS).min(MAX_MS));
    if let Some(ms) = req.wait_idle_ms {
        settle_into_idle(s, Duration::from_millis(ms.min(MAX_MS)));
    }
    let cursor = s.settle().transcript.next();
    let base = ctx.signals.lock().unwrap_or_else(|e| e.into_inner()).seq;
    ctx.target = req.target.clone();
    let receipt = match deliver(s, &req.text, &ctx).map_err(|e| Fail::new(Code::Exited, e))? {
        Delivered::Sent(receipt) => receipt,
        Delivered::Refused(receipt) => {
            let code = receipt.get("code").cloned().unwrap_or(json!("guard"));
            let ms = start.elapsed().as_millis() as u64;
            return Ok(
                json!({ "ok": true, "outcome": "refused", "code": code, "receipt": receipt, "duration_ms": ms }),
            );
        }
        Delivered::Unavailable(why) => {
            return Err(Fail::new(
                Code::Guard,
                format!("no delivery channel: {why}"),
            ));
        }
    };
    // timeout_ms bounds the turn itself, so time a channel spent before falling back is not
    // taken from it; duration_ms still reports the whole request.
    let delivered = Instant::now();
    let mut busy_seen = false;
    let mut screen_done: Option<Instant> = None;
    loop {
        let mut t = s.settle();
        let snap = snapshot(s, &mut t);
        busy_seen |= snap.matched.busy.is_some();
        let screen_reply = reply_lines(&t.transcript.lines_since(cursor), &req.text);
        let (hooks_live, signal, asked) = {
            let g = ctx.signals.lock().unwrap_or_else(|e| e.into_inner());
            let asked = g
                .permission
                .as_ref()
                .filter(|p| p.0 > base)
                .map(|p| p.1.clone());
            (g.hooks_live, ended(&g, base), asked)
        };
        let screen_ready = snap.status == "idle" && (busy_seen || !screen_reply.is_empty());
        screen_done = if screen_ready {
            screen_done.or(Some(Instant::now()))
        } else {
            None
        };
        let quiet_hooks = screen_done.is_some_and(|at| !hooks_live || at.elapsed() >= HOOK_GRACE);
        let finished = match () {
            _ if snap.status == "exited" => end("exited", "screen"),
            _ if snap.status == "dialog" => end("dialog", "screen"),
            _ if signal.is_some() => signal.map(|(by, reply, stop)| End {
                outcome: "completed",
                by,
                reply: Some(reply).filter(|r| !r.is_empty()),
                stop_reason: stop,
            }),
            _ if asked.is_some() => Some(End {
                outcome: "dialog",
                by: "hook",
                reply: asked,
                stop_reason: None,
            }),
            _ if quiet_hooks => end("completed", "screen"),
            _ if delivered.elapsed() >= deadline => end("timeout", "none"),
            _ => None,
        };
        if let Some(e) = finished {
            let dialog = match &snap.matched.dialog {
                Some(name) => parse_dialog(&s.profile, &t.rows(), name),
                None => Value::Null,
            };
            let reply = e.reply.unwrap_or_else(|| screen_reply.join("\n"));
            return Ok(json!({
                "ok": true, "outcome": e.outcome, "completed_by": e.by, "stop_reason": e.stop_reason,
                "receipt": receipt, "reply": reply, "dialog": dialog, "hooks_live": hooks_live,
                "duration_ms": start.elapsed().as_millis() as u64, "next": t.transcript.next(),
                "instance": instance,
            }));
        }
        let left = deadline.saturating_sub(delivered.elapsed());
        drop(s.wait_changed(t, left.min(Duration::from_millis(100))));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reply_starts_after_the_echo_and_keeps_lines_that_quote_the_input() {
        let lines: Vec<String> = ["old", "> say hi", "you said: say hi", "done"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert_eq!(
            reply_lines(&lines, "say hi"),
            vec!["you said: say hi", "done"]
        );
        assert_eq!(reply_lines(&lines, "not echoed"), lines);
    }
}
