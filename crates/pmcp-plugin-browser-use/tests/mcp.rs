#![cfg(unix)]
// The real binary over stdio: it answers MCP without starting Chromium until a page tool runs,
// refuses file:// at navigate, and holds one of the two host-wide browser slots.
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
        let mut child = Command::new(env!("CARGO_BIN_EXE_pmcp-browser"))
            .args(["serve", "--no-scope"])
            .env("XDG_STATE_HOME", state)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
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

    fn call(&mut self, id: u64, method: &str, params: Value) -> Value {
        let msg = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        writeln!(self.stdin, "{msg}").unwrap();
        loop {
            let line = self
                .lines
                .recv_timeout(Duration::from_secs(30))
                .expect("no reply");
            let v: Value = serde_json::from_str(&line).unwrap();
            if v["id"] == json!(id) {
                return v;
            }
        }
    }

    fn init(&mut self) {
        let info = json!({ "name": "test", "version": "0" });
        let params =
            json!({ "protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": info });
        let init = self.call(1, "initialize", params);
        assert_eq!(
            init["result"]["serverInfo"]["name"], "pmcp-browser",
            "{init}"
        );
        writeln!(
            self.stdin,
            "{}",
            json!({ "jsonrpc": "2.0", "method": "notifications/initialized" })
        )
        .unwrap();
    }
}

#[test]
fn the_browser_server_lists_its_tools_refuses_file_urls_and_caps_itself_at_two() {
    let state = std::env::temp_dir().join(format!("pmcp-browser-mcp-{}", std::process::id()));
    let mut a = Client::start(&state);
    a.init();
    let list = a.call(2, "tools/list", json!({}));
    let names: Vec<&str> = list["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["name"].as_str().unwrap())
        .collect();
    for want in [
        "navigate",
        "snapshot",
        "click",
        "type",
        "read_text",
        "screenshot",
        "tabs",
        "downloads",
        "close",
    ] {
        assert!(names.contains(&want), "{want} missing from {names:?}");
    }
    let file = a.call(
        3,
        "tools/call",
        json!({ "name": "navigate", "arguments": { "url": "file:///etc/passwd" } }),
    );
    assert_eq!(file["result"]["isError"], true, "{file}");
    assert!(
        file["result"]["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("only http and https")
    );

    let mut b = Client::start(&state);
    b.init();
    // A third server finds both slots taken. It still answers MCP, so the agent sees why on
    // each call instead of a tool that vanished at startup.
    let mut c = Client::start(&state);
    c.init();
    let listed = c.call(2, "tools/list", json!({}));
    assert!(listed["result"]["tools"].as_array().unwrap().len() > 5);
    let refused = c.call(
        3,
        "tools/call",
        json!({ "name": "navigate", "arguments": { "url": "https://example.com/" } }),
    );
    assert_eq!(refused["result"]["isError"], true, "{refused}");
    let why = refused["result"]["content"][0]["text"].as_str().unwrap();
    assert!(why.contains("both browser slots are taken"), "{why}");

    for mut c in [a, b, c] {
        drop(c.stdin);
        assert!(c.child.wait().unwrap().success());
    }
    let _ = std::fs::remove_dir_all(&state);
}
