#![cfg(unix)]
mod common;

use common::{Host, fixture, wait_for};
use serde_json::json;
use std::time::Duration;

fn running(pid: u32) -> bool {
    std::fs::read_to_string(format!("/proc/{pid}/stat"))
        .map(|s| {
            !s.rsplit(')')
                .next()
                .unwrap_or("")
                .trim_start()
                .starts_with('Z')
        })
        .unwrap_or(false)
}

fn pid_in(dir: &std::path::Path, name: &str) -> u32 {
    let mut text = String::new();
    wait_for(name, Duration::from_secs(5), || {
        text = std::fs::read_to_string(dir.join(name)).unwrap_or_default();
        !text.trim().is_empty()
    });
    text.trim().parse().unwrap()
}

fn forker(host: &Host, label: &str) -> (String, std::path::PathBuf) {
    let dir = host.dir.join(label);
    std::fs::create_dir_all(&dir).unwrap();
    let r = host.req(json!({ "op": "spawn", "argv": ["sh", fixture("fake_forker.sh"), dir] }));
    let id = r["id"].as_str().unwrap().to_string();
    host.wait_screen(&id, "ready");
    (id, dir)
}

// The process group and the tree walked before signalling take the helpers a runtime leaves;
// a helper that double-forked into its own session before the kill escapes both.
#[test]
fn kill_takes_the_group_and_the_tree_but_not_a_double_forked_daemon() {
    let host = Host::start("reap");
    let (id, dir) = forker(&host, "kill");
    let (grandchild, setsid, escaped) = (
        pid_in(&dir, "grandchild"),
        pid_in(&dir, "setsid-child"),
        pid_in(&dir, "double-forked"),
    );
    assert!(running(grandchild) && running(setsid) && running(escaped));
    assert_eq!(host.req(json!({ "op": "kill", "id": id }))["ok"], true);
    wait_for("tree gone", Duration::from_secs(8), || {
        !running(grandchild) && !running(setsid)
    });
    assert!(
        running(escaped),
        "a double-forked setsid'd helper was expected to escape"
    );
    unsafe { libc::kill(escaped as i32, libc::SIGKILL) };
}

#[test]
fn shutdown_waits_for_every_session_tree() {
    let host = Host::start("reap-down");
    let (_, dir) = forker(&host, "down");
    let (grandchild, setsid, escaped) = (
        pid_in(&dir, "grandchild"),
        pid_in(&dir, "setsid-child"),
        pid_in(&dir, "double-forked"),
    );
    let reply = host.req(json!({ "op": "shutdown" }));
    assert_eq!(reply["ok"], true);
    // Live, pids of a tree were still up two seconds after shutdown replied; the reply waits now.
    assert!(!running(grandchild) && !running(setsid));
    unsafe { libc::kill(escaped as i32, libc::SIGKILL) };
}

#[test]
fn shutdown_replies_only_after_a_leader_that_ignores_hup_is_gone() {
    let host = Host::start_with("reap-leader-down", &fixture("delivery.toml"));
    let argv = json!([fixture("fake_grok.py")]);
    let r = host.req(
        json!({ "op": "spawn", "argv": argv, "profile": "fake-grok", "delivery_setup": true }),
    );
    let socket = std::path::PathBuf::from(r["channel"]["leader_socket"].as_str().unwrap());
    let log = socket.parent().unwrap().join("acp.log");
    let leader = pid_in_log(&log);
    assert!(running(leader));
    assert_eq!(host.req(json!({ "op": "shutdown" }))["ok"], true);
    assert!(!running(leader));
    // Live, per-instance dirs stayed behind after shutdown.
    assert!(!socket.parent().unwrap().parent().unwrap().exists());
}

fn pid_in_log(log: &std::path::Path) -> u32 {
    let mut text = String::new();
    wait_for("leader pid", Duration::from_secs(10), || {
        text = std::fs::read_to_string(log).unwrap_or_default();
        text.contains("leader pid ")
    });
    text.lines()
        .find_map(|l| l.strip_prefix("leader pid "))
        .and_then(|rest| rest.split_whitespace().next())
        .and_then(|pid| pid.parse().ok())
        .unwrap()
}

// The live leader outlived its TUI with ppid 1 and ignored SIGTERM; a leader the session owns
// is its child and gets KILL after the HUP grace when the TUI exits.
#[test]
fn the_session_owned_grok_leader_stops_with_its_tui_even_when_it_ignores_hup() {
    let host = Host::start_with("reap-leader", &fixture("delivery.toml"));
    let argv = json!([fixture("fake_grok.py")]);
    let r = host.req(
        json!({ "op": "spawn", "argv": argv, "profile": "fake-grok", "delivery_setup": true }),
    );
    let id = r["id"].as_str().unwrap().to_string();
    host.req(json!({ "op": "wait", "id": id, "until": ["idle"], "timeout_ms": 10000 }));
    let socket = std::path::PathBuf::from(r["channel"]["leader_socket"].as_str().unwrap());
    let log = socket.parent().unwrap().join("acp.log");
    let line = std::fs::read_to_string(&log).unwrap();
    let leader: u32 = line
        .lines()
        .find_map(|l| l.strip_prefix("leader pid "))
        .and_then(|rest| rest.split_whitespace().next())
        .and_then(|pid| pid.parse().ok())
        .unwrap_or_else(|| panic!("no leader in {line}"));
    assert!(line.contains("--relay-on-demand"), "{line}");
    assert!(running(leader));
    assert_eq!(
        host.req(json!({ "op": "observe", "id": id }))["status"],
        "idle"
    );
    host.req(json!({ "op": "write", "id": id, "text": "exit", "submit": true, "guard": "none" }));
    wait_for("leader gone", Duration::from_secs(8), || !running(leader));
}
