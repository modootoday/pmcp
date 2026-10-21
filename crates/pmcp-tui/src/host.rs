use crate::state::{Event, SessionInfo};
use pmcp_pty::UnixStream;
use pmcp_pty::client::{attach_stream, request};
use pmcp_pty::proto::{AttachReq, Request};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::io::Read;
use std::path::PathBuf;
use std::sync::mpsc::Sender;

// The pmcp-pty side of the workspace: which sessions exist, and one attach stream per shown
// session whose bytes come back as events.
pub struct PtyHost {
    pub socket: PathBuf,
    // Only sessions carrying every label, e.g. pmcp.host=<name> for one approved host.
    pub labels: BTreeMap<String, String>,
    // The main session by id or name; otherwise one labelled pmcp.role=main, else the first.
    pub main: Option<String>,
}

fn text(v: &Value, key: &str) -> String {
    v[key].as_str().unwrap_or_default().to_string()
}

impl PtyHost {
    pub fn sessions(&self) -> Result<Vec<SessionInfo>, String> {
        let listed = request(
            &self.socket,
            &Request::List {
                labels: self.labels.clone(),
            },
        )?;
        let rows = listed["sessions"].as_array().cloned().unwrap_or_default();
        let mut out = Vec::new();
        for s in &rows {
            let id = text(s, "id");
            // A session that exits between list and observe is simply left out this round.
            let Ok(o) = request(
                &self.socket,
                &Request::Observe {
                    id: id.clone(),
                    lines: Some(0),
                },
            ) else {
                continue;
            };
            if o["ok"] != true {
                continue;
            }
            out.push(SessionInfo {
                name: Some(text(s, "name"))
                    .filter(|n| !n.is_empty())
                    .unwrap_or_else(|| id.clone()),
                runtime: text(&o, "runtime"),
                status: text(&o, "status"),
                alive: o["alive"] == true,
                cols: o["size"]["cols"].as_u64().unwrap_or(80) as u16,
                rows: o["size"]["rows"].as_u64().unwrap_or(24) as u16,
                main: s["labels"]["pmcp.role"] == "main",
                id,
            });
        }
        let chosen = match &self.main {
            Some(m) => out.iter().position(|s| &s.id == m || &s.name == m),
            None => out
                .iter()
                .position(|s| s.main)
                .or((!out.is_empty()).then_some(0)),
        };
        for (i, s) in out.iter_mut().enumerate() {
            s.main = Some(i) == chosen;
        }
        Ok(out)
    }

    /// One request as JSON; a transport failure comes back as a reply with a code.
    pub fn call(&self, req: Value) -> Value {
        let parsed: Result<Request, _> = serde_json::from_value(req);
        let reply = parsed
            .map_err(|e| e.to_string())
            .and_then(|r| request(&self.socket, &r));
        reply.unwrap_or_else(
            |why| json!({ "ok": false, "code": "host_unreachable", "message": why }),
        )
    }

    /// Attaches and pumps the session's bytes into events until the stream ends. A sized attach
    /// resizes the session to the pane; only a writable one is sized.
    pub fn attach(
        &self,
        id: &str,
        serial: u64,
        read_only: bool,
        size: Option<(u16, u16)>,
        lease: Option<String>,
        tx: Sender<Event>,
    ) -> Result<UnixStream, String> {
        let req = AttachReq {
            id: id.into(),
            cols: size.map(|s| s.0),
            rows: size.map(|s| s.1),
            read_only,
            resize: Some(size.is_some()),
            lease,
        };
        let stream = attach_stream(&self.socket, req)?;
        let mut reader = stream.try_clone().map_err(|e| e.to_string())?;
        std::thread::spawn(move || {
            let mut buf = [0u8; 16 * 1024];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let bytes = buf[..n].to_vec();
                        if tx.send(Event::Output { serial, bytes }).is_err() {
                            return;
                        }
                    }
                }
            }
            let _ = tx.send(Event::Closed { serial });
        });
        Ok(stream)
    }
}
