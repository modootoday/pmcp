#![cfg(unix)]
mod common;

use common::{Host, fixture, wait_for};
use serde_json::{Value, json};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::os::unix::net::UnixListener;
use std::time::Duration;

fn spawn(host: &Host, profile: &str, argv: Value, env: Value) -> Value {
    let r = host.req(json!({ "op": "spawn", "argv": argv, "profile": profile, "env": env, "cols": 80, "rows": 24, "delivery_setup": true }));
    assert_eq!(r["ok"], true, "{r}");
    let idle =
        host.req(json!({ "op": "wait", "id": r["id"], "until": ["idle"], "timeout_ms": 10000 }));
    assert_eq!(idle["fired"], "idle", "{idle}");
    r
}

fn fake_agent() -> Value {
    json!(["python3", fixture("fake_agent.py")])
}

fn log_of(path: &std::path::Path) -> String {
    std::fs::read_to_string(path).unwrap_or_default()
}

#[test]
fn claude_inbox_posts_one_user_frame_and_without_a_session_file_falls_back_to_screen() {
    let host = Host::start_with("claude", &fixture("delivery.toml"));
    // A launcher between pmcp-pty and the runtime, as in the live run: sh stays the parent.
    let script = format!("python3 {}; true", fixture("fake_agent.py").display());
    let r = spawn(&host, "fake-claude", json!(["sh", "-c", script]), json!({}));
    let shell = r["pid"].as_u64().unwrap();
    let children = std::fs::read_to_string(format!("/proc/{shell}/task/{shell}/children")).unwrap();
    let runtime: u64 = children.split_whitespace().next().unwrap().parse().unwrap();
    let fallback =
        host.req(json!({ "op": "turn", "id": r["id"], "text": "via screen", "timeout_ms": 10000 }));
    assert_eq!(fallback["receipt"]["channel"], "screen", "{fallback}");
    let why = fallback["receipt"]["fallback"].as_str().unwrap();
    assert!(
        why.starts_with("claude-inbox: no Claude session file for pid"),
        "{why}"
    );
    assert_eq!(fallback["reply"], "echo: via screen\nsecond line");

    let sessions = host.dir.join("home/.claude/sessions");
    std::fs::create_dir_all(&sessions).unwrap();
    let inbox = host.dir.join("inbox.sock");
    let listener = UnixListener::bind(&inbox).unwrap();
    let file = json!({ "pid": runtime, "sessionId": "c-1", "messagingSocketPath": inbox });
    std::fs::write(sessions.join(format!("{runtime}.json")), file.to_string()).unwrap();
    let reader = std::thread::spawn(move || {
        let (stream, _) = listener.accept().unwrap();
        let mut line = String::new();
        BufReader::new(stream).read_line(&mut line).unwrap();
        line
    });
    let t =
        host.req(json!({ "op": "turn", "id": r["id"], "text": "hello inbox", "timeout_ms": 800 }));
    assert_eq!(t["receipt"]["channel"], "claude-inbox", "{t}");
    assert_eq!(t["receipt"]["session"], "c-1");
    let frame: Value = serde_json::from_str(&reader.join().unwrap()).unwrap();
    assert_eq!(frame["type"], "user");
    assert_eq!(
        frame["message"],
        json!({ "role": "user", "content": "hello inbox" })
    );
    assert_eq!(frame["from"], "pmcp-pty");
}

#[test]
fn http_prompt_async_posts_to_the_pinned_port_with_basic_auth() {
    let host = Host::start_with("opencode", &fixture("delivery.toml"));
    let r = spawn(
        &host,
        "fake-opencode",
        fake_agent(),
        json!({ "OPENCODE_SERVER_PASSWORD": "pw" }),
    );
    let url = r["channel"]["url"].as_str().unwrap().to_string();
    let server = TcpListener::bind(url.trim_start_matches("http://")).unwrap();
    let got = std::thread::spawn(move || {
        let (mut stream, _) = server.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let mut buf = vec![0u8; 8192];
        let n = stream.read(&mut buf).unwrap();
        stream
            .write_all(b"HTTP/1.1 204 No Content\r\nContent-Length: 0\r\n\r\n")
            .unwrap();
        String::from_utf8_lossy(&buf[..n]).to_string()
    });
    let target = json!({ "session": "ses_1" });
    let t = host.req(json!({ "op": "turn", "id": r["id"], "text": "hello server", "timeout_ms": 800, "target": target }));
    assert_eq!(t["receipt"]["channel"], "http-prompt-async", "{t}");
    assert_eq!(t["receipt"]["status"], 204);
    let request = got.join().unwrap();
    assert!(
        request.starts_with("POST /session/ses_1/prompt_async HTTP/1.1"),
        "{request}"
    );
    assert!(
        request.contains("Authorization: Basic b3BlbmNvZGU6cHc="),
        "{request}"
    );
    assert!(
        request.ends_with(r#"{"parts":[{"text":"hello server","type":"text"}]}"#),
        "{request}"
    );
}

#[test]
fn codex_queue_uses_the_private_app_server_which_stops_with_the_tui() {
    let host = Host::start_with("codex", &fixture("delivery.toml"));
    let r = spawn(
        &host,
        "fake-codex",
        json!([fixture("fake_codex.py")]),
        json!({}),
    );
    let remote = r["channel"]["remote"].as_str().unwrap().to_string();
    let socket = std::path::PathBuf::from(remote.trim_start_matches("unix://"));
    let log = socket.parent().unwrap().join("codex.log");
    assert!(log_of(&log).contains(&format!(
        "app-server listening {}",
        remote.trim_start_matches("unix://")
    )));
    assert!(
        log_of(&log).contains(&format!("tui --remote {remote}")),
        "{}",
        log_of(&log)
    );
    let helper = socket.parent().unwrap().join("helper.log");
    assert!(log_of(&helper).contains("invalid_grant"));
    let id = r["id"].as_str().unwrap();
    assert!(!host.screen_text(id).contains("invalid_grant"));

    let none =
        host.req(json!({ "op": "turn", "id": r["id"], "text": "no thread", "timeout_ms": 10000 }));
    assert_eq!(none["receipt"]["channel"], "screen");
    let why = none["receipt"]["fallback"].as_str().unwrap();
    assert!(
        why.contains("codex-queue: no target session; thread/loaded/list on the private app-server returned 0 threads"),
        "{none}"
    );

    // No hook reported a thread: the private app-server's one loaded thread is the target.
    std::fs::write(
        socket.parent().unwrap().join("loaded.json"),
        r#"["t-loaded"]"#,
    )
    .unwrap();
    host.req(json!({ "op": "wait", "id": r["id"], "until": ["idle"], "timeout_ms": 10000 }));
    let asked =
        host.req(json!({ "op": "turn", "id": r["id"], "text": "via list", "timeout_ms": 800 }));
    assert_eq!(asked["receipt"]["channel"], "codex-queue", "{asked}");
    assert!(
        asked
            .to_string()
            .contains(r#""thread_from":"thread/loaded/list""#),
        "{asked}"
    );
    assert!(log_of(&log).contains("--thread t-loaded --message via list"));
    assert!(log_of(&log).contains("rpc initialize\nrpc initialized\nrpc thread/loaded/list"));

    let target = json!({ "session": "thread-1" });
    let t = host.req(json!({ "op": "turn", "id": r["id"], "text": "hello codex", "timeout_ms": 800, "target": target }));
    assert_eq!(t["receipt"]["channel"], "codex-queue", "{t}");
    assert!(log_of(&log).contains(&format!(
        "queue --remote {remote} --thread thread-1 --message hello codex"
    )));

    // With no loaded thread the turn falls back to the screen, where the fake TUI reads exit.
    std::fs::remove_file(socket.parent().unwrap().join("loaded.json")).unwrap();
    host.req(json!({ "op": "wait", "id": r["id"], "until": ["idle"], "timeout_ms": 10000 }));
    let bye = host.req(json!({ "op": "turn", "id": r["id"], "text": "exit", "timeout_ms": 10000 }));
    assert_eq!(bye["outcome"], "exited", "{bye}");
    wait_for("app-server stopped", Duration::from_secs(5), || {
        log_of(&log).contains("app-server stopped")
    });
}
