use crate::delivery::{Ctx, Delivered, Delivery};
use crate::session::Session;
use serde_json::{Value, json};
use std::io::Write;
use std::time::{SystemTime, UNIX_EPOCH};

// Claude Code's documented cross-session inbox: the session file of the process pmcp-pty
// spawned names its socket; one NDJSON user line asks for a turn. pmcp-pty only reads the file.
// A target in bypassPermissions holds the message for approval; nothing here changes settings.
pub struct ClaudeInbox;

fn session_file(home: &str, pid: u32) -> Option<Value> {
    let path = format!("{home}/.claude/sessions/{pid}.json");
    serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
}

fn msg_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("pmcp-pty-{}-{nanos}", std::process::id())
}

impl Delivery for ClaudeInbox {
    fn channel(&self) -> &'static str {
        "claude-inbox"
    }

    fn deliver(&self, s: &Session, text: &str, ctx: &Ctx) -> Result<Delivered, String> {
        let (Some(pid), Some(home)) = (s.pid, ctx.home.as_deref()) else {
            return Ok(Delivered::Unavailable("no pid or HOME".into()));
        };
        // The spawned pid may be a launcher (a scope wrapper, a shell); the claude process that
        // owns the session file is somewhere in its tree.
        let found = crate::reap::tree(pid)
            .into_iter()
            .find_map(|p| session_file(home, p));
        let Some(file) = found else {
            return Ok(Delivered::Unavailable(format!(
                "no Claude session file for pid {pid} or its descendants"
            )));
        };
        let Some(socket) = file["messagingSocketPath"].as_str() else {
            return Ok(Delivered::Unavailable(
                "the session file names no inbox socket".into(),
            ));
        };
        let frame = json!({
            "type": "user", "message": { "role": "user", "content": text },
            "from": "pmcp-pty", "msg_id": msg_id(),
        });
        let sent = crate::transport::UnixStream::connect(socket)
            .and_then(|mut stream| stream.write_all(format!("{frame}\n").as_bytes()));
        if let Err(e) = sent {
            return Ok(Delivered::Unavailable(format!("inbox {socket}: {e}")));
        }
        Ok(Delivered::Sent(json!({
            "ok": true, "accepted": true, "submitted": true, "socket": socket,
            "session": file["sessionId"], "msg_id": frame["msg_id"],
        })))
    }
}
