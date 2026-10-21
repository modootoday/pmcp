// The grok leader channel, split from delivery.rs to keep each test file short.
#![cfg(unix)]
mod common;

use common::{Host, fixture, wait_for};
use serde_json::{Value, json};
use std::time::Duration;

fn spawn(host: &Host, profile: &str, argv: Value, env: Value) -> Value {
    let r = host.req(json!({ "op": "spawn", "argv": argv, "profile": profile, "env": env, "cols": 80, "rows": 24, "delivery_setup": true }));
    assert_eq!(r["ok"], true, "{r}");
    let idle =
        host.req(json!({ "op": "wait", "id": r["id"], "until": ["idle"], "timeout_ms": 10000 }));
    assert_eq!(idle["fired"], "idle", "{idle}");
    r
}

fn log_of(path: &std::path::Path) -> String {
    std::fs::read_to_string(path).unwrap_or_default()
}

#[test]
fn grok_leader_acp_loads_an_unknown_session_once_and_never_answers_permission() {
    let host = Host::start_with("grok", &fixture("delivery.toml"));
    let r = spawn(
        &host,
        "fake-grok",
        json!([fixture("fake_grok.py")]),
        json!({}),
    );
    let socket = std::path::PathBuf::from(r["channel"]["leader_socket"].as_str().unwrap());
    let log = socket.parent().unwrap().join("acp.log");
    assert!(
        log_of(&log).contains("tui --leader --leader-socket"),
        "{}",
        log_of(&log)
    );

    let target = json!({ "session": "needs-load" });
    let t = host.req(json!({ "op": "turn", "id": r["id"], "text": "hello grok", "timeout_ms": 800, "target": target }));
    assert_eq!(t["receipt"]["channel"], "grok-leader-acp", "{t}");
    assert_eq!(t["receipt"]["session"], "needs-load");
    let methods = || -> Vec<String> {
        log_of(&log)
            .lines()
            .filter_map(|l| l.strip_prefix("recv "))
            .map(|l| serde_json::from_str::<Value>(l).unwrap())
            .map(|m| {
                m["method"]
                    .as_str()
                    .map_or(format!("reply {}", m["id"]), String::from)
            })
            .collect()
    };
    let want = [
        "initialize",
        "session/prompt",
        "session/load",
        "session/prompt",
    ];
    wait_for("acp flow", Duration::from_secs(5), || {
        methods().len() >= want.len()
    });
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(
        methods(),
        want,
        "the permission request (id 99) must never be answered"
    );
}

#[test]
fn a_grok_prompt_that_never_starts_falls_back_to_screen_within_the_deadline_and_is_logged() {
    let host = Host::start_with("grok-silent", &fixture("delivery.toml"));
    let r = spawn(
        &host,
        "fake-grok",
        json!([fixture("fake_grok.py")]),
        json!({}),
    );
    let target = json!({ "session": "silent" });
    let started = std::time::Instant::now();
    let t = host.req(json!({ "op": "turn", "id": r["id"], "text": "hello grok", "timeout_ms": 10000, "target": target }));
    assert!(started.elapsed() < Duration::from_secs(25), "{t}");
    assert_eq!(t["receipt"]["channel"], "screen", "{t}");
    let why = t["receipt"]["fallback"].as_str().unwrap();
    assert!(
        why.contains("grok-leader-acp: no ACP reply to request 2 within 15s"),
        "{why}"
    );
    assert_eq!(t["outcome"], "completed");
    let socket = std::path::PathBuf::from(r["channel"]["leader_socket"].as_str().unwrap());
    let debug = log_of(&socket.parent().unwrap().join("acp.log"));
    assert!(
        debug.contains("> {") && debug.contains("session/prompt") && debug.contains("gave up"),
        "{debug}"
    );
}
