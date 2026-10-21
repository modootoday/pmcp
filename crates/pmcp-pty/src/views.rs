// The original screen and state replies, kept unchanged for existing callers; observe is the
// typed view an AI caller should use.
use crate::proto::utc_iso;
use crate::session::Session;
use serde_json::{Value, json};

pub fn screen(s: &Session) -> Value {
    let t = s.term();
    let sc = t.parser.screen();
    let (rows, cols) = sc.size();
    let (crow, ccol) = sc.cursor_position();
    let lines: Vec<String> = sc
        .rows(0, cols.get())
        .map(|r| r.trim_end().to_string())
        .collect();
    json!({
        "ok": true, "rows": lines, "cursor": { "row": crow, "col": ccol }, "title": t.parser.callbacks().title,
        "size": { "cols": cols.get(), "rows": rows.get() }, "alternate_screen": sc.alternate_screen(),
        "bracketed_paste": sc.bracketed_paste(),
    })
}

pub fn state(s: &Session) -> Value {
    let (m, idle_ms, alive) = s.observe();
    let t = s.term();
    let exit = t.exit.clone();
    let input_box_empty = match m.dialog {
        Some(_) => None,
        None => m.input_empty,
    };
    json!({
        "ok": true, "id": s.id, "name": s.name, "profile": s.profile.name, "pid": s.pid, "alive": alive,
        "exit_code": exit.as_ref().map(|e| e.code), "signal": exit.and_then(|e| e.signal),
        "idle_ms": idle_ms, "idle": idle_ms >= s.profile.idle_ms, "last_output_at": utc_iso(t.last_output_wall),
        "input_box_empty": input_box_empty, "dialog": m.dialog, "dialog_source": m.dialog_source, "busy": m.busy,
    })
}
