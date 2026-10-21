#![allow(dead_code)]

use serde_json::{Value, json};
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::time::{Duration, Instant};

pub struct Host {
    pub child: Child,
    pub dir: PathBuf,
    pub socket: PathBuf,
}

pub fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name)
}

impl Host {
    pub fn start(tag: &str) -> Host {
        Host::start_with(
            tag,
            &PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("profiles.toml"),
        )
    }

    pub fn start_with(tag: &str, profiles: &Path) -> Host {
        Host::start_args(tag, profiles, &[])
    }

    pub fn start_args(tag: &str, profiles: &Path, extra: &[&Path]) -> Host {
        let dir = std::env::temp_dir().join(format!("pmcp-pty-test-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        // portable-pty starts a child without cwd in HOME, so the private HOME must exist.
        std::fs::create_dir_all(dir.join("home")).unwrap();
        let socket = dir.join("d.sock");
        let child = Command::new(env!("CARGO_BIN_EXE_pmcp-pty"))
            .args(["daemon", "--socket"])
            .arg(&socket)
            .arg("--profiles")
            .arg(profiles)
            .arg("--fixtures")
            .arg(dir.join("fixtures"))
            .args(extra)
            // A private HOME, so no test daemon ever reads the real ~/.claude.
            .env("HOME", dir.join("home"))
            // Markers of a spawner's own session, which spawn must not pass on (control.rs).
            .env("CLAUDE_CODE_CHILD_SESSION", "1")
            .env("GROK_SESSION_ID", "g-1")
            .spawn()
            .unwrap();
        let host = Host { child, dir, socket };
        wait_for("socket", Duration::from_secs(5), || {
            UnixStream::connect(&host.socket).is_ok()
        });
        host
    }

    pub fn conn(&self) -> (UnixStream, BufReader<UnixStream>) {
        let s = UnixStream::connect(&self.socket).unwrap();
        let r = BufReader::new(s.try_clone().unwrap());
        (s, r)
    }

    pub fn req(&self, v: Value) -> Value {
        let (mut s, mut r) = self.conn();
        s.write_all(format!("{v}\n").as_bytes()).unwrap();
        let mut line = String::new();
        r.read_line(&mut line).unwrap();
        serde_json::from_str(&line).unwrap()
    }

    pub fn screen_text(&self, id: &str) -> String {
        let s = self.req(json!({ "op": "screen", "id": id }));
        s["rows"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| r.as_str().unwrap())
            .collect::<Vec<_>>()
            .join("\n")
    }

    pub fn wait_screen(&self, id: &str, needle: &str) {
        wait_for(needle, Duration::from_secs(10), || {
            self.screen_text(id).contains(needle)
        });
    }

    pub fn wait_state(&self, id: &str, what: &str, f: impl Fn(&Value) -> bool) -> Value {
        let mut last = Value::Null;
        wait_for(what, Duration::from_secs(10), || {
            last = self.req(json!({ "op": "state", "id": id }));
            f(&last)
        });
        last
    }
}

// Processes whose command line names this test's directory: everything the test started.
fn survivors(dir: &Path) -> Vec<u32> {
    let needle = dir.display().to_string();
    let Ok(entries) = std::fs::read_dir("/proc") else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|e| e.file_name().to_string_lossy().parse::<u32>().ok())
        .filter(|pid| {
            let cmdline = std::fs::read(format!("/proc/{pid}/cmdline")).unwrap_or_default();
            let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).unwrap_or_default();
            let zombie = stat
                .rsplit(')')
                .next()
                .unwrap_or("")
                .trim_start()
                .starts_with('Z');
            !zombie && String::from_utf8_lossy(&cmdline).contains(&needle)
        })
        .collect()
}

impl Host {
    // A shutdown reaps every session tree, HUP then KILL; killing the daemon alone left fake grok
    // leaders, which ignore HUP and TERM like the live one, orphaned after every run.
    fn shutdown_quietly(&self) {
        let Ok(mut s) = UnixStream::connect(&self.socket) else {
            return;
        };
        let _ = s.set_read_timeout(Some(Duration::from_secs(15)));
        if s.write_all(b"{\"op\":\"shutdown\"}\n").is_ok() {
            let mut line = String::new();
            let _ = BufReader::new(s).read_line(&mut line);
        }
    }
}

impl Drop for Host {
    fn drop(&mut self) {
        self.shutdown_quietly();
        let _ = self.child.kill();
        let _ = self.child.wait();
        let mut left = survivors(&self.dir);
        let start = Instant::now();
        while !left.is_empty() && start.elapsed() < Duration::from_secs(3) {
            std::thread::sleep(Duration::from_millis(100));
            left = survivors(&self.dir);
        }
        for pid in &left {
            unsafe { libc::kill(*pid as i32, libc::SIGKILL) };
        }
        let _ = std::fs::remove_dir_all(&self.dir);
        if !left.is_empty() && !std::thread::panicking() {
            panic!("processes outlived the test and were killed: {left:?}");
        }
    }
}

pub fn wait_for(what: &str, limit: Duration, mut f: impl FnMut() -> bool) {
    let start = Instant::now();
    while !f() {
        assert!(start.elapsed() < limit, "timed out waiting for {what}");
        std::thread::sleep(Duration::from_millis(50));
    }
}

pub fn spawn_bash(host: &Host, name: &str) -> String {
    let argv = ["bash", "--norc", "--noprofile", "-i"];
    let r = host.req(json!({ "op": "spawn", "name": name, "argv": argv, "env": { "PS1": "$ " }, "cols": 80, "rows": 24 }));
    assert_eq!(r["ok"], true, "{r}");
    let id = r["id"].as_str().unwrap().to_string();
    host.wait_screen(&id, "$");
    id
}
