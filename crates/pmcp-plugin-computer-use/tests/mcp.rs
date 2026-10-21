#![cfg(unix)]
// The real binary over stdio, as Claude or Codex would start it: initialize, list, call.
use serde_json::{Value, json};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

struct Client {
    child: Child,
    stdin: ChildStdin,
    lines: mpsc::Receiver<String>,
}

impl Client {
    fn start(state: &std::path::Path) -> Client {
        let mut child = Command::new(env!("CARGO_BIN_EXE_pmcp-desktop"))
            .args(["serve", "--no-scope", "--geometry", "640x480x24"])
            .env("XDG_STATE_HOME", state)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let stdin = child.stdin.take().unwrap();
        let stdout = child.stdout.take().unwrap();
        let (tx, lines) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let _ = tx.send(line);
            }
        });
        Client {
            child,
            stdin,
            lines,
        }
    }

    fn send(&mut self, v: Value) {
        writeln!(self.stdin, "{v}").unwrap();
    }

    fn reply(&mut self, id: u64) -> Value {
        loop {
            let line = self
                .lines
                .recv_timeout(Duration::from_secs(15))
                .expect("no reply");
            let v: Value = serde_json::from_str(&line).unwrap();
            if v["id"] == json!(id) {
                return v;
            }
        }
    }
}

#[test]
fn an_mcp_client_lists_the_desktop_tools_and_gets_a_png_screenshot() {
    let state = std::env::temp_dir().join(format!("pmcp-desktop-mcp-{}", std::process::id()));
    let mut c = Client::start(&state);
    let info = json!({ "name": "test", "version": "0" });
    c.send(json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": { "protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": info } }));
    let init = c.reply(1);
    assert_eq!(
        init["result"]["serverInfo"]["name"], "pmcp-desktop",
        "{init}"
    );
    c.send(json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }));
    c.send(json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }));
    let list = c.reply(2);
    let names: Vec<&str> = list["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["name"].as_str().unwrap())
        .collect();
    assert!(
        names.contains(&"screenshot") && names.contains(&"launch"),
        "{names:?}"
    );
    c.send(json!({ "jsonrpc": "2.0", "id": 3, "method": "tools/call",
        "params": { "name": "screenshot", "arguments": {} } }));
    let shot = c.reply(3);
    let content = &shot["result"]["content"];
    assert_eq!(content[0]["type"], "image", "{shot}");
    assert_eq!(content[0]["mimeType"], "image/png");
    assert!(
        content[0]["data"]
            .as_str()
            .unwrap()
            .starts_with("iVBORw0KGgo")
    );
    assert!(
        content[1]["text"]
            .as_str()
            .unwrap()
            .starts_with("640x480 screenshot")
    );
    c.send(json!({ "jsonrpc": "2.0", "id": 4, "method": "tools/call",
        "params": { "name": "launch", "arguments": { "app": "xterm" } } }));
    assert_eq!(c.reply(4)["result"]["isError"], true);
    drop(c.stdin);
    let status = c.child.wait().unwrap();
    assert!(status.success(), "{status}");
    assert!(
        std::fs::read_dir("/tmp/.X11-unix")
            .unwrap()
            .flatten()
            .all(|e| {
                let name = e.file_name().to_string_lossy().to_string();
                !(name.starts_with("X9")
                    && std::fs::read_to_string(format!("/tmp/.X{}-lock", &name[1..])).is_err())
            })
    );
    let _ = std::fs::remove_dir_all(&state);
}
