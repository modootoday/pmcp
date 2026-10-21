#![cfg(unix)]
mod common;

use common::{Host, fixture};
use serde_json::{Value, json};
use std::io::{BufRead, Write};

fn fake(host: &Host, name: &str) -> (String, Value) {
    let argv = json!(["python3", fixture("fake_agent.py")]);
    let r = host.req(json!({ "op": "spawn", "name": name, "argv": argv, "profile": "fake", "cols": 80, "rows": 24, "labels": { "owner": "test" } }));
    assert_eq!(r["ok"], true, "{r}");
    let id = r["id"].as_str().unwrap().to_string();
    let idle = host.req(json!({ "op": "wait", "id": id, "until": ["idle"], "timeout_ms": 10000 }));
    assert_eq!(idle["fired"], "idle", "{idle}");
    (id, r)
}

#[test]
fn turn_returns_the_reply_without_echo_or_spinner_and_read_pages_new_text() {
    let host = Host::start_with("turn", &fixture("fake.toml"));
    let (id, spawned) = fake(&host, "a");
    assert!(spawned["pid"].is_u64(), "{spawned}");
    assert!(
        spawned["instance"].as_str().unwrap().contains('-'),
        "{spawned}"
    );
    let seen = host.req(json!({ "op": "observe", "id": id }));
    assert_eq!(
        (seen["status"].clone(), seen["input"].clone()),
        (json!("idle"), json!("")),
        "{seen}"
    );
    assert_eq!(seen["labels"]["owner"], "test");

    let t = host.req(json!({ "op": "turn", "id": id, "text": "hello there", "timeout_ms": 10000 }));
    assert_eq!(t["outcome"], "completed", "{t}");
    assert_eq!(t["receipt"]["channel"], "screen");
    assert_eq!(t["receipt"]["fallback"], "");
    assert_eq!(t["reply"], "echo: hello there\nsecond line", "{t}");

    let all = host.req(json!({ "op": "read", "id": id, "since": 0 }));
    let text = all["text"].as_str().unwrap();
    assert!(
        text.contains("fake agent ready") && text.contains("user: hello there"),
        "{text}"
    );
    for noise in ["esc to cancel", "⠋", "⠙"] {
        assert!(!text.contains(noise), "{noise} in {text}");
    }
    let after = host.req(json!({ "op": "read", "id": id, "since": t["next"] }));
    assert_eq!(after["text"], "", "{after}");
}

#[test]
fn turn_stops_at_a_dialog_with_parsed_options_and_reports_exit() {
    let host = Host::start_with("dialog", &fixture("fake.toml"));
    let (id, spawned) = fake(&host, "b");
    let t = host.req(json!({ "op": "turn", "id": id, "text": "dialog", "timeout_ms": 10000 }));
    assert_eq!(t["outcome"], "dialog", "{t}");
    let d = &t["dialog"];
    assert_eq!(d["name"], "exec");
    assert_eq!(d["prompt"], "Allow execution of: 'rm -rf build'?");
    assert_eq!(d["selected"], "1");
    assert_eq!(
        d["options"],
        json!([{ "key": "1", "label": "Allow once" }, { "key": "2", "label": "Deny" }])
    );
    assert_eq!(
        host.req(json!({ "op": "observe", "id": id }))["status"],
        "dialog"
    );
    let refused = host.req(json!({ "op": "turn", "id": id, "text": "more" }));
    assert_eq!(
        (refused["outcome"].clone(), refused["code"].clone()),
        (json!("refused"), json!("dialog_open"))
    );

    let wrong_pid = json!({ "pid": 1 });
    let stale = host.req(json!({ "op": "key", "id": id, "key": "1", "expect": wrong_pid }));
    assert_eq!(stale["code"], "stale", "{stale}");
    let wrong_instance = json!({ "instance": "0-0" });
    let stale = host.req(json!({ "op": "key", "id": id, "key": "1", "expect": wrong_instance }));
    assert_eq!(stale["code"], "stale", "{stale}");
    let right = json!({ "instance": spawned["instance"], "pid": spawned["pid"] });
    assert_eq!(
        host.req(json!({ "op": "key", "id": id, "key": "1", "expect": right }))["ok"],
        true
    );
    let chose = host.req(
        json!({ "op": "wait", "id": id, "until": [{ "text": "chose 1" }], "timeout_ms": 10000 }),
    );
    assert_eq!(chose["fired"], "text:chose 1", "{chose}");

    host.req(json!({ "op": "wait", "id": id, "until": ["idle"], "timeout_ms": 10000 }));
    let bye = host.req(json!({ "op": "turn", "id": id, "text": "exit", "timeout_ms": 10000 }));
    assert_eq!(bye["outcome"], "exited", "{bye}");
    let end = host.req(json!({ "op": "observe", "id": id }));
    assert_eq!(
        (end["status"].clone(), end["exit_code"].clone()),
        (json!("exited"), json!(3))
    );
}

#[test]
fn errors_carry_codes_and_list_filters_by_label() {
    let host = Host::start_with("codes", &fixture("fake.toml"));
    let (mut s, mut r) = host.conn();
    s.write_all(b"not json\n").unwrap();
    let mut line = String::new();
    r.read_line(&mut line).unwrap();
    let bad: Value = serde_json::from_str(&line).unwrap();
    assert_eq!(bad["code"], "bad_request", "{bad}");
    assert_eq!(
        host.req(json!({ "op": "observe", "id": "s9" }))["code"],
        "not_found"
    );

    for team in ["a", "b"] {
        let r =
            host.req(json!({ "op": "spawn", "argv": ["sleep", "30"], "labels": { "team": team } }));
        assert_eq!(r["ok"], true, "{r}");
    }
    let listed = host.req(json!({ "op": "list", "labels": { "team": "a" } }));
    let sessions = listed["sessions"].as_array().unwrap();
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0]["labels"]["team"], "a");
    assert!(listed["instance"].is_string());

    let id = sessions[0]["id"].as_str().unwrap();
    let unknown = host.req(json!({ "op": "wait", "id": id, "until": ["soon"] }));
    assert_eq!(unknown["code"], "bad_request");
    let timeout =
        host.req(json!({ "op": "wait", "id": id, "until": ["dialog"], "timeout_ms": 300 }));
    assert_eq!(timeout["fired"], "timeout", "{timeout}");
    assert!(timeout["after_ms"].as_u64().unwrap() >= 300);
}

// Live: codex took a turn sent while its banner was up for a box holding a draft. A quiet
// screen with no input box is busy (retry soon), and wait_idle_ms waits for the box.
#[test]
fn a_turn_before_the_input_box_appears_waits_for_it_instead_of_reading_a_draft() {
    let host = Host::start_with("slow-prompt", &fixture("fake.toml"));
    let argv = json!(["python3", fixture("fake_agent.py")]);
    let env = json!({ "FAKE_SLOW_PROMPT": "2.5" });
    let r = host.req(json!({ "op": "spawn", "argv": argv, "profile": "fake", "env": env }));
    let id = r["id"].as_str().unwrap().to_string();
    host.wait_screen(&id, "starting servers");
    std::thread::sleep(std::time::Duration::from_millis(600));
    let seen = host.req(json!({ "op": "observe", "id": id }));
    assert_eq!(seen["status"], "starting", "{seen}");
    let early = host.req(json!({ "op": "turn", "id": id, "text": "too early" }));
    assert_eq!(
        (early["outcome"].clone(), early["code"].clone()),
        (json!("refused"), json!("busy")),
        "{early}"
    );
    assert!(
        early.to_string().contains("no input box on screen yet"),
        "{early}"
    );
    let waited = host.req(json!({ "op": "turn", "id": id, "text": "after the box", "wait_idle_ms": 10000, "timeout_ms": 10000 }));
    assert_eq!(waited["outcome"], "completed", "{waited}");
    assert_eq!(waited["reply"], "echo: after the box\nsecond line");
}

#[test]
fn a_hosted_child_learns_its_host_and_a_spawn_request_cannot_forge_it() {
    let host = Host::start_with("env", &fixture("fake.toml"));
    let script = "printf '%s|%s|%s\\n' \"$PMCP_PTY_SOCKET\" \"$PMCP_PTY_SESSION\" \"$PMCP_PTY_INSTANCE\"; sleep 30";
    let forged = json!({ "PMCP_PTY_SESSION": "s99", "PMCP_PTY_SOCKET": "/tmp/other.sock" });
    let r = host
        .req(json!({ "op": "spawn", "argv": ["sh", "-c", script], "env": forged, "cols": 200 }));
    let id = r["id"].as_str().unwrap();
    let want = format!(
        "{}|{id}|{}",
        host.socket.display(),
        r["instance"].as_str().unwrap()
    );
    host.wait_screen(id, &want);
}
