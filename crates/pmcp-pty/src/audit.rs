use crate::clock::utc_iso;
use crate::proto::Request;
use crate::transport::{UnixStream, peer_pid};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::sync::Mutex;
use std::time::SystemTime;

// Every input that can change a session is written down with who sent it, so an unattended
// host can be reviewed afterwards. Text is kept as a length and a hash, never the words.
pub struct Caller {
    pub pid: Option<u32>,
    pub exe: Option<String>,
}

pub fn caller_of(stream: &UnixStream) -> Caller {
    let pid = peer_pid(stream);
    let exe = pid
        .and_then(|p| std::fs::read_link(format!("/proc/{p}/exe")).ok())
        .map(|p| p.display().to_string());
    Caller { pid, exe }
}

pub fn digest(text: &str) -> String {
    let hash = Sha256::digest(text.as_bytes());
    hash.iter().map(|b| format!("{b:02x}")).collect()
}

fn text(op: &str, id: &str, t: &str) -> Value {
    json!({ "op": op, "id": id, "len": t.len(), "sha256": digest(t) })
}

/// What to keep of a request; None for requests that only read.
pub fn describe(req: &Request) -> Option<Value> {
    let v = match req {
        Request::Spawn(s) => {
            let argv0 = s.argv.first().cloned().unwrap_or_default();
            json!({ "op": "spawn", "argv0": argv0, "profile": s.profile, "labels": s.labels, "delivery_setup": s.delivery_setup })
        }
        Request::Write(w) => {
            let mut v = text("write", &w.id, &w.text);
            v["submit"] = json!(w.submit);
            v
        }
        Request::Turn(t) => text("turn", &t.id, &t.text),
        Request::Key { id, key, .. } => json!({ "op": "key", "id": id, "key": key }),
        Request::Answer(a) => {
            json!({ "op": "answer", "id": a.id, "dialog": a.dialog, "option": a.option })
        }
        Request::Resize { id, cols, rows, .. } => {
            json!({ "op": "resize", "id": id, "cols": cols, "rows": rows })
        }
        Request::Kill { id, signal, .. } => json!({ "op": "kill", "id": id, "signal": signal }),
        Request::Remove { id } => json!({ "op": "remove", "id": id }),
        Request::Detach { id } => json!({ "op": "detach", "id": id }),
        Request::Record { id, label, .. } => json!({ "op": "record", "id": id, "label": label }),
        Request::Event {
            id, kind, message, ..
        } => {
            let len = message.as_deref().map_or(0, str::len);
            json!({ "op": "event", "id": id, "kind": kind, "len": len })
        }
        Request::Lease(l) => {
            let token = l.token.as_deref().map(digest);
            json!({ "op": "lease", "id": l.id, "token_sha256": token, "release": l.release })
        }
        Request::Shutdown => json!({ "op": "shutdown" }),
        _ => return None,
    };
    Some(v)
}

pub fn op_name(req: &Request) -> String {
    let v = serde_json::to_value(req).unwrap_or_default();
    v["op"].as_str().unwrap_or_default().to_string()
}

/// The audit entry for a request; over MCP even reads are kept, marked with via.
pub fn entry_for(req: &Request, mcp: bool) -> Option<Value> {
    if !mcp {
        return describe(req);
    }
    let v = serde_json::to_value(req).unwrap_or_default();
    let mut entry = describe(req).unwrap_or_else(|| json!({ "op": v["op"], "id": v["id"] }));
    entry["via"] = json!("mcp");
    Some(entry)
}

pub struct Audit {
    file: Mutex<Option<File>>,
}

impl Audit {
    // Beside the socket and owner-only, like the socket itself.
    pub fn open(socket: &Path) -> Audit {
        let path = socket.with_extension("audit.jsonl");
        let mut options = OpenOptions::new();
        options.create(true).append(true);
        #[cfg(unix)]
        std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
        Audit {
            file: Mutex::new(options.open(path).ok()),
        }
    }

    pub fn record(&self, caller: &Caller, mut entry: Value, reply: &Value) {
        entry["at"] = json!(utc_iso(SystemTime::now()));
        entry["caller"] = json!({ "pid": caller.pid, "exe": caller.exe });
        for key in [
            "ok",
            "code",
            "accepted",
            "outcome",
            "completed_by",
            "screen_sha256",
            "allowed",
        ] {
            if let Some(v) = reply.get(key) {
                entry[key] = v.clone();
            }
        }
        if let Some(channel) = reply.get("receipt").and_then(|r| r.get("channel")) {
            entry["channel"] = channel.clone();
        }
        let mut file = self.file.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(f) = file.as_mut() {
            let _ = writeln!(f, "{entry}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_is_kept_as_length_and_hash_and_reads_are_not_kept() {
        let w: Request =
            serde_json::from_str(r#"{"op":"write","id":"s1","text":"secret plan"}"#).unwrap();
        let v = describe(&w).unwrap();
        assert_eq!(v["len"], 11);
        assert_eq!(v["sha256"], digest("secret plan"));
        assert!(!v.to_string().contains("secret plan"));
        let r: Request = serde_json::from_str(r#"{"op":"observe","id":"s1"}"#).unwrap();
        assert!(describe(&r).is_none());
        assert_eq!(
            digest("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
