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

// How long to let a busy refusal stand before the idle wait looks again.
const BUSY_RETRY: Duration = Duration::from_millis(50);

fn busy_refusal(delivered: &Delivered) -> bool {
    matches!(delivered, Delivered::Refused(r) if r.get("code") == Some(&json!("busy")))
}

// With wait_idle_ms the whole budget covers delivery too: the runtime can turn busy between the
// idle wait and the delivery (a hook starting on its own), so a busy refusal waits for idle
// again and retries until the budget is spent, and only then is returned.
fn deliver_within<X>(
    budget: Option<Duration>,
    mut settle: impl FnMut(Duration),
    mut attempt: impl FnMut() -> Result<(X, Delivered), String>,
) -> Result<(X, Delivered), String> {
    let until = budget.map(|b| {
        settle(b);
        Instant::now() + b
    });
    loop {
        let (x, delivered) = attempt()?;
        let left = until.map(|u| u.saturating_duration_since(Instant::now()));
        match left {
            Some(left) if !left.is_zero() && busy_refusal(&delivered) => {
                std::thread::sleep(BUSY_RETRY.min(left));
                settle(left.saturating_sub(BUSY_RETRY));
            }
            _ => return Ok((x, delivered)),
        }
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
    ctx.target = req.target.clone();
    let budget = req
        .wait_idle_ms
        .map(|ms| Duration::from_millis(ms.min(MAX_MS)));
    let ((cursor, base), delivered) = deliver_within(
        budget,
        |left| settle_into_idle(s, left),
        || {
            let cursor = s.settle().transcript.next();
            let base = ctx.signals.lock().unwrap_or_else(|e| e.into_inner()).seq;
            Ok(((cursor, base), deliver(s, &req.text, &ctx)?))
        },
    )
    .map_err(|e| Fail::new(Code::Exited, e))?;
    let receipt = match delivered {
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

    fn busy() -> Delivered {
        Delivered::Refused(json!({ "code": "busy", "reason": "runtime busy: working" }))
    }

    // Busy for the first `refusals` attempts, then accepted; counts attempts and idle waits.
    fn run(budget: Option<Duration>, refusals: usize) -> (Delivered, usize, usize) {
        let (mut tries, mut waits) = (0, 0);
        let ((), delivered) = deliver_within(
            budget,
            |_| waits += 1,
            || {
                tries += 1;
                Ok((
                    (),
                    if tries <= refusals {
                        busy()
                    } else {
                        Delivered::Sent(json!({}))
                    },
                ))
            },
        )
        .unwrap();
        (delivered, tries, waits)
    }

    #[test]
    fn a_busy_refusal_inside_the_wait_budget_waits_for_idle_and_delivers_again() {
        let (delivered, tries, waits) = run(Some(Duration::from_secs(5)), 2);
        assert!(matches!(delivered, Delivered::Sent(_)));
        assert_eq!(tries, 3);
        assert_eq!(waits, 3, "the first idle wait, then one before each retry");
    }

    #[test]
    fn without_wait_idle_ms_a_busy_refusal_is_returned_at_once() {
        let (delivered, tries, waits) = run(None, 1);
        assert!(busy_refusal(&delivered));
        assert_eq!((tries, waits), (1, 0));
    }

    #[test]
    fn a_spent_budget_returns_the_busy_refusal() {
        let start = Instant::now();
        let (delivered, tries, _) = run(Some(Duration::from_millis(200)), usize::MAX);
        assert!(busy_refusal(&delivered));
        assert!(tries >= 2, "{tries}");
        assert!(start.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn other_refusals_are_never_retried() {
        let (mut tries, mut waits) = (0, 0);
        let ((), delivered) = deliver_within(
            Some(Duration::from_secs(5)),
            |_| waits += 1,
            || {
                tries += 1;
                Ok(((), Delivered::Refused(json!({ "code": "dialog_open" }))))
            },
        )
        .unwrap();
        assert!(matches!(delivered, Delivered::Refused(_)));
        assert_eq!((tries, waits), (1, 1));
    }
}
