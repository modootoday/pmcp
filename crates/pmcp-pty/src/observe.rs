use crate::dialog::parse_dialog;
use crate::profile::{Profile, ScreenMatch};
use crate::session::Session;
use crate::term::Term;
use crate::transcript::clean;
use crate::version::drift;
use serde_json::{Value, json};

const DEFAULT_LINES: usize = 20;

pub struct Snapshot {
    pub status: &'static str,
    pub matched: ScreenMatch,
    pub idle_ms: u64,
}

// The one status an AI caller branches on; starting lasts until the session was first idle.
pub fn snapshot(s: &Session, t: &mut Term) -> Snapshot {
    let matched = s.profile.observe_typed(&t.screen_text(), &t.typed_text());
    let idle_ms = t.last_output.elapsed().as_millis() as u64;
    // Quiet with no input box yet is not idle: a turn waits for the box instead of refusing.
    let ready = !s.profile.composer_missing(&matched);
    let quiet = idle_ms >= s.profile.idle_ms && matched.busy.is_none() && ready;
    let status = match () {
        _ if t.exit.is_some() => "exited",
        _ if matched.dialog.is_some() => "dialog",
        _ if quiet => "idle",
        _ if !t.ever_idle => "starting",
        _ => "busy",
    };
    if quiet {
        t.ever_idle = true;
    }
    Snapshot {
        status,
        matched,
        idle_ms,
    }
}

fn tail_lines(profile: &Profile, rows: &[String], n: usize) -> Vec<String> {
    let clean_rows: Vec<String> = rows
        .iter()
        .map(|r| clean(r))
        .filter(|r| !r.is_empty() && !profile.is_chrome(r))
        .collect();
    clean_rows[clean_rows.len().saturating_sub(n)..].to_vec()
}

pub fn observe(s: &Session, instance: &str, lines: Option<usize>) -> Value {
    let mut t = s.settle();
    let snap = snapshot(s, &mut t);
    let rows = t.rows();
    let dialog = match &snap.matched.dialog {
        Some(name) => parse_dialog(&s.profile, &rows, name),
        None => Value::Null,
    };
    let (rows_n, cols_n) = t.parser.screen().size();
    let exit = t.exit.clone();
    // Detection runs after spawn; until it reports, there is nothing to compare yet.
    let warning = match &t.version {
        Some(got) => drift(s.profile.version.as_deref(), Some(got)),
        None => None,
    };
    json!({
        "ok": true, "id": s.id, "name": s.name, "status": snap.status, "dialog": dialog,
        "input": s.profile.draft(&rows.join("\n"), &t.typed_text()),
        "tail_lines": tail_lines(&s.profile, &rows, lines.unwrap_or(DEFAULT_LINES)),
        "runtime": s.profile.name, "version": t.version, "profile_version": s.profile.version,
        "version_warning": warning, "version_pending": s.profile.version.is_some() && t.version.is_none(),
        "labels": s.labels,
        "pid": s.pid, "instance": instance, "alive": exit.is_none(),
        "exit_code": exit.as_ref().map(|e| e.code), "signal": exit.and_then(|e| e.signal),
        "busy": snap.matched.busy, "idle_ms": snap.idle_ms,
        "size": { "cols": cols_n.get(), "rows": rows_n.get() }, "next": t.transcript.next(),
    })
}
