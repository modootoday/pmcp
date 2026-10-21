// A real pmcp-pty daemon with the fake agent runtime for pmcp-tui's tests; no real agent runs.
#![allow(dead_code)]
use serde_json::{Value, json};
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::time::{Duration, Instant};

fn pty_crate() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../pmcp-pty")
}

// The host binary from its own crate; build it there first (cargo build in crates/pmcp-pty).
fn pty_bin() -> PathBuf {
    std::env::var_os("PMCP_PTY_BIN")
        .map(PathBuf::from)
        .unwrap_or_else(|| pty_crate().join("target/debug/pmcp-pty"))
}

pub struct Host {
    child: Child,
    dir: PathBuf,
    pub socket: PathBuf,
}

impl Host {
    pub fn start(tag: &str) -> Host {
        let dir = std::env::temp_dir().join(format!("pmcp-tui-test-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("home")).unwrap();
        let socket = dir.join("d.sock");
        let bin = pty_bin();
        assert!(
            bin.exists(),
            "{} is missing: build crates/pmcp-pty first",
            bin.display()
        );
        let child = Command::new(bin)
            .args(["daemon", "--socket"])
            .arg(&socket)
            .arg("--profiles")
            .arg(pty_crate().join("tests/fixtures/fake.toml"))
            .env("HOME", dir.join("home"))
            .spawn()
            .unwrap();
        let host = Host { child, dir, socket };
        wait("socket", || UnixStream::connect(&host.socket).is_ok());
        host
    }

    pub fn req(&self, v: Value) -> Value {
        let mut s = UnixStream::connect(&self.socket).unwrap();
        s.write_all(format!("{v}\n").as_bytes()).unwrap();
        let mut line = String::new();
        BufReader::new(s).read_line(&mut line).unwrap();
        serde_json::from_str(&line).unwrap()
    }

    pub fn fake(&self, name: &str, role: &str) -> String {
        let argv = json!(["python3", pty_crate().join("tests/fixtures/fake_agent.py")]);
        let labels = json!({ "pmcp.role": role, "pmcp.host": "t" });
        let r = self.req(json!({ "op": "spawn", "name": name, "argv": argv, "profile": "fake", "cols": 60, "rows": 10, "labels": labels }));
        assert_eq!(r["ok"], true, "{r}");
        let id = r["id"].as_str().unwrap().to_string();
        let idle =
            self.req(json!({ "op": "wait", "id": id, "until": ["idle"], "timeout_ms": 10000 }));
        assert_eq!(idle["fired"], "idle", "{idle}");
        id
    }

    pub fn screen(&self, id: &str) -> String {
        let s = self.req(json!({ "op": "screen", "id": id }));
        s["rows"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| r.as_str().unwrap())
            .collect::<Vec<_>>()
            .join("\n")
    }

    pub fn wait_screen(&self, id: &str, needle: &str) -> String {
        let start = Instant::now();
        loop {
            let last = self.screen(id);
            if last.contains(needle) {
                return last;
            }
            let late = start.elapsed() > Duration::from_secs(10);
            assert!(!late, "timed out waiting for {needle}; screen:\n{last}");
            std::thread::sleep(Duration::from_millis(50));
        }
    }
}

impl Drop for Host {
    fn drop(&mut self) {
        if let Ok(mut s) = UnixStream::connect(&self.socket) {
            let _ = s.set_read_timeout(Some(Duration::from_secs(15)));
            let _ = s.write_all(b"{\"op\":\"shutdown\"}\n");
            let _ = BufReader::new(s).read_line(&mut String::new());
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

impl Host {
    // The TUI finds the daemon through PMCP_PTY_SOCKET, which pmcp-pty gives every child.
    pub fn tui(&self) -> String {
        let argv = json!([env!("CARGO_BIN_EXE_pmcp-tui"), "--host", "t"]);
        let r = self
            .req(json!({ "op": "spawn", "name": "tui", "argv": argv, "cols": 160, "rows": 48 }));
        let id = r["id"].as_str().unwrap().to_string();
        self.wait_screen(&id, "WORKERS / observe only");
        id
    }

    // Text arrives as a paste (the TUI turns bracketed paste on). The TUI redraws on its own, so
    // its screen is never idle: writes to it skip the idle guard.
    pub fn type_into(&self, id: &str, text: &str) {
        let r = self.req(json!({ "op": "write", "id": id, "text": text, "guard": "none" }));
        assert!(r["ok"] == true && r["outcome"] != "refused", "{r}");
    }

    pub fn key(&self, id: &str, key: &str) {
        let r = self.req(json!({ "op": "key", "id": id, "key": key }));
        assert_eq!(r["ok"], true, "{r}");
    }

    pub fn press(&self, id: &str, key: &str) {
        self.key(id, "C-g");
        self.key(id, key);
    }
}

pub fn wait(what: &str, mut f: impl FnMut() -> bool) {
    let start = Instant::now();
    while !f() {
        assert!(
            start.elapsed() < Duration::from_secs(10),
            "timed out waiting for {what}"
        );
        std::thread::sleep(Duration::from_millis(50));
    }
}
