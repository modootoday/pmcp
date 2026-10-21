use crate::error::{Code, Fail};
use crate::observe::{observe, snapshot};
use crate::proto::{Until, WaitReq};
use crate::session::Session;
use regex::Regex;
use serde_json::{Value, json};
use std::time::{Duration, Instant};

const WAIT_DEFAULT_MS: u64 = 30_000;
const MAX_MS: u64 = 600_000;
const NAMES: [&str; 5] = ["idle", "turn_end", "dialog", "exit", "output"];

struct Seen {
    output: bool,
    busy: bool,
}

enum Cond {
    Named(String),
    Text(Regex),
}

fn conditions(until: &[Until]) -> Result<Vec<Cond>, Fail> {
    until
        .iter()
        .map(|u| match u {
            Until::Named(n) if NAMES.contains(&n.as_str()) => Ok(Cond::Named(n.clone())),
            Until::Named(n) => Err(Fail::new(Code::BadRequest, format!("unknown until {n}"))),
            Until::Text { text } => Regex::new(text)
                .map(Cond::Text)
                .map_err(|e| Fail::new(Code::BadRequest, format!("until text: {e}"))),
        })
        .collect()
}

fn limit(ms: Option<u64>, default: u64) -> Duration {
    Duration::from_millis(ms.unwrap_or(default).min(MAX_MS))
}

pub fn wait(s: &Session, instance: &str, req: WaitReq) -> Result<Value, Fail> {
    let conds = conditions(&req.until)?;
    let start = Instant::now();
    let deadline = limit(req.timeout_ms, WAIT_DEFAULT_MS);
    let (first_output, cursor) = {
        let t = s.settle();
        (t.last_output, t.transcript.next())
    };
    let mut seen = Seen {
        output: false,
        busy: false,
    };
    loop {
        let mut t = s.settle();
        let snap = snapshot(s, &mut t);
        seen.output |= t.last_output > first_output;
        seen.busy |= snap.status == "busy";
        let text = format!(
            "{}\n{}",
            t.transcript.lines_since(cursor).join("\n"),
            t.screen_text()
        );
        let fired = conds.iter().find_map(|c| match c {
            Cond::Named(n) if fires(n, snap.status, &seen) => Some(n.clone()),
            Cond::Text(re) if re.is_match(&text) => Some(format!("text:{}", re.as_str())),
            _ => None,
        });
        let timed_out = start.elapsed() >= deadline;
        if fired.is_some() || timed_out || snap.status == "exited" {
            drop(t);
            let fired =
                fired.unwrap_or_else(|| (if timed_out { "timeout" } else { "exited" }).into());
            let after_ms = start.elapsed().as_millis() as u64;
            return Ok(
                json!({ "ok": true, "fired": fired, "after_ms": after_ms, "observe": observe(s, instance, None) }),
            );
        }
        let left = deadline.saturating_sub(start.elapsed());
        drop(s.wait_changed(t, left.min(Duration::from_millis(100))));
    }
}

fn fires(name: &str, status: &str, seen: &Seen) -> bool {
    match name {
        "idle" => status == "idle",
        "turn_end" => status == "idle" && (seen.output || seen.busy),
        "dialog" => status == "dialog",
        "exit" => status == "exited",
        _ => seen.output,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_wait_names_and_bad_regexes_are_bad_requests() {
        let bad = conditions(&[Until::Named("soon".into())]).err().unwrap();
        assert_eq!(bad.code, Code::BadRequest);
        let regex = conditions(&[Until::Text { text: "(".into() }])
            .err()
            .unwrap();
        assert_eq!(regex.code, Code::BadRequest);
        assert_eq!(
            conditions(&[Until::Named("turn_end".into())])
                .unwrap()
                .len(),
            1
        );
    }
}
