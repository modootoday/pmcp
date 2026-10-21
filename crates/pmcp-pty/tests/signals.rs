#![cfg(unix)]
mod common;

use common::{Host, fixture};
use serde_json::{Value, json};
use std::io::Read;
use std::net::TcpListener;
use std::time::{Duration, Instant};

fn fake(host: &Host, profile: &str, argv: Value, setup: bool) -> Value {
    let r = host.req(json!({ "op": "spawn", "argv": argv, "profile": profile, "cols": 80, "rows": 24, "delivery_setup": setup }));
    assert_eq!(r["ok"], true, "{r}");
    let idle =
        host.req(json!({ "op": "wait", "id": r["id"], "until": ["idle"], "timeout_ms": 10000 }));
    assert_eq!(idle["fired"], "idle", "{idle}");
    r
}

fn agent() -> Value {
    json!(["python3", fixture("fake_agent.py")])
}

// A turn that ends while the screen still looks busy or blank: the hook's word wins.
#[test]
fn a_hook_turn_end_completes_the_turn_with_the_hooks_message() {
    let host = Host::start_with("sig-hook", &fixture("fake.toml"));
    let r = fake(&host, "fake", agent(), false);
    let id = r["id"].as_str().unwrap().to_string();
    let event = |kind: &str, message: Option<&str>| json!({ "op": "event", "id": id, "kind": kind, "message": message, "session": "rt-1" });
    assert_eq!(host.req(event("session_start", None))["ok"], true);
    let bad = host.req(json!({ "op": "event", "id": id, "kind": "nonsense" }));
    assert_eq!(bad["code"], "bad_request");

    let socket = host.socket.clone();
    let hook = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(150));
        let mut s = std::os::unix::net::UnixStream::connect(&socket).unwrap();
        let line =
            json!({ "op": "event", "id": "s1", "kind": "turn_end", "message": "HOOK-REPLY" });
        std::io::Write::write_all(&mut s, format!("{line}\n").as_bytes()).unwrap();
    });
    let t = host.req(json!({ "op": "turn", "id": id, "text": "hello", "timeout_ms": 10000 }));
    hook.join().unwrap();
    assert_eq!(
        (t["outcome"].clone(), t["completed_by"].clone()),
        (json!("completed"), json!("hook")),
        "{t}"
    );
    assert_eq!(t["reply"], "HOOK-REPLY");
}

#[test]
fn live_but_silent_hooks_leave_the_screen_to_end_the_turn_after_a_grace() {
    let host = Host::start_with("sig-silent", &fixture("fake.toml"));
    let r = fake(&host, "fake", agent(), false);
    host.req(json!({ "op": "event", "id": r["id"], "kind": "session_start" }));
    let started = Instant::now();
    let t = host.req(json!({ "op": "turn", "id": r["id"], "text": "hello", "timeout_ms": 20000 }));
    assert_eq!(
        (t["outcome"].clone(), t["completed_by"].clone()),
        (json!("completed"), json!("screen")),
        "{t}"
    );
    assert_eq!(t["hooks_live"], true);
    assert!(
        started.elapsed() >= Duration::from_secs(5),
        "the screen waited for the hook grace"
    );
    assert_eq!(t["reply"], "echo: hello\nsecond line");
}

// The live opencode run posted to a guessed session the TUI did not show; now the first turn
// goes to the screen, and the session the hooks report is the target afterwards.
#[test]
fn a_structured_channel_targets_only_the_session_the_hooks_reported() {
    let host = Host::start_with("sig-learn", &fixture("delivery.toml"));
    let r = fake(&host, "fake-opencode", agent(), true);
    let first =
        host.req(json!({ "op": "turn", "id": r["id"], "text": "first", "timeout_ms": 10000 }));
    assert_eq!(first["receipt"]["channel"], "screen", "{first}");
    assert_eq!(
        first["receipt"]["fallback"],
        "http-prompt-async: no target session"
    );

    host.req(json!({ "op": "event", "id": r["id"], "kind": "turn_start", "session": "ses_tui" }));
    let url = r["channel"]["url"].as_str().unwrap().to_string();
    let server = TcpListener::bind(url.trim_start_matches("http://")).unwrap();
    let got = std::thread::spawn(move || {
        let (mut stream, _) = server.accept().unwrap();
        let mut buf = vec![0u8; 4096];
        let n = stream.read(&mut buf).unwrap();
        std::io::Write::write_all(
            &mut stream,
            b"HTTP/1.1 204 No Content\r\nContent-Length: 0\r\n\r\n",
        )
        .unwrap();
        String::from_utf8_lossy(&buf[..n]).to_string()
    });
    let second =
        host.req(json!({ "op": "turn", "id": r["id"], "text": "second", "timeout_ms": 600 }));
    assert_eq!(
        second["receipt"]["channel"], "http-prompt-async",
        "{second}"
    );
    assert!(
        got.join()
            .unwrap()
            .starts_with("POST /session/ses_tui/prompt_async")
    );
}

#[test]
fn a_channel_end_completes_a_turn_the_tui_never_drew() {
    let host = Host::start_with("sig-acp", &fixture("delivery.toml"));
    let r = fake(&host, "fake-grok", json!([fixture("fake_grok.py")]), true);
    let target = json!({ "session": "known" });
    let t = host.req(json!({ "op": "turn", "id": r["id"], "text": "hello grok", "timeout_ms": 10000, "target": target }));
    assert_eq!(t["receipt"]["channel"], "grok-leader-acp", "{t}");
    assert_eq!(
        (t["completed_by"].clone(), t["stop_reason"].clone()),
        (json!("channel"), json!("end_turn")),
        "{t}"
    );
    assert_eq!(t["reply"], "ACP-REPLY");
}
