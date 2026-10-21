#![cfg(unix)]
mod common;

use common::{Host, fixture};
use serde_json::{Value, json};
use std::io::{BufRead, Write};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::time::Duration;

fn fake(host: &Host) -> String {
    let argv = json!(["python3", fixture("fake_agent.py")]);
    let r =
        host.req(json!({ "op": "spawn", "argv": argv, "profile": "fake", "cols": 80, "rows": 24 }));
    let id = r["id"].as_str().unwrap().to_string();
    host.req(json!({ "op": "wait", "id": id, "until": ["idle"], "timeout_ms": 10000 }));
    id
}

fn audit(host: &Host) -> Vec<Value> {
    let text = std::fs::read_to_string(host.socket.with_extension("audit.jsonl")).unwrap();
    text.lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect()
}

#[test]
fn each_input_is_audited_with_its_caller_and_without_its_text() {
    let host = Host::start_with("audit", &fixture("fake.toml"));
    let id = fake(&host);
    host.req(json!({ "op": "write", "id": id, "text": "private words", "submit": true }));
    host.req(json!({ "op": "observe", "id": id }));
    let path = host.socket.with_extension("audit.jsonl");
    assert_eq!(
        std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o600
    );
    let raw = std::fs::read_to_string(&path).unwrap();
    assert!(!raw.contains("private words"), "{raw}");
    let entries = audit(&host);
    let ops: Vec<&str> = entries.iter().map(|e| e["op"].as_str().unwrap()).collect();
    assert_eq!(ops, ["spawn", "write"], "{raw}");
    let write = &entries[1];
    assert_eq!(write["len"], 13);
    assert_eq!(write["caller"]["pid"], std::process::id());
    assert_eq!(write["ok"], true);
}

#[test]
fn a_live_lease_needs_its_token_and_a_person_typing_wins_for_a_few_seconds() {
    let host = Host::start_with("lease", &fixture("fake.toml"));
    let id = fake(&host);
    let set = host.req(json!({ "op": "lease", "id": id, "token": "t1", "ttl_ms": 60000 }));
    assert_eq!(set["leased"], true, "{set}");
    assert_eq!(
        host.req(json!({ "op": "observe", "id": id }))["leased"],
        true
    );
    let bare = host.req(json!({ "op": "write", "id": id, "text": "x" }));
    assert_eq!(bare["code"], "lease", "{bare}");
    let other = host.req(json!({ "op": "lease", "id": id, "token": "t2" }));
    assert_eq!(other["code"], "lease", "{other}");
    let held =
        host.req(json!({ "op": "write", "id": id, "text": "x", "expect": { "lease": "t1" } }));
    assert_eq!(held["ok"], true, "{held}");
    host.req(json!({ "op": "lease", "id": id, "current": "t1", "release": true }));
    host.req(json!({ "op": "key", "id": id, "key": "Backspace" }));

    let (mut person, mut person_r) = host.conn();
    person
        .write_all(format!("{}\n", json!({ "op": "attach", "id": id })).as_bytes())
        .unwrap();
    let mut line = String::new();
    person_r.read_line(&mut line).unwrap();
    assert_eq!(host.req(json!({ "op": "observe", "id": id }))["humans"], 1);
    person.write_all(b"h").unwrap();
    std::thread::sleep(Duration::from_millis(200));
    let busy = host.req(json!({ "op": "turn", "id": id, "text": "hello" }));
    assert_eq!(busy["code"], "conflict", "{busy}");
    assert!(busy["retry_after_ms"].as_u64().unwrap() > 0, "{busy}");
}

// A leased session takes a writable attach only with the token; viewers are always let in, and a
// writer whose lease was taken over stops typing at once.
#[test]
fn a_writable_attach_needs_the_live_lease_token() {
    let host = Host::start_with("attach-lease", &fixture("fake.toml"));
    let id = fake(&host);
    host.req(json!({ "op": "lease", "id": id, "token": "t1", "ttl_ms": 60000 }));
    let attach = |extra: Value| {
        let (mut s, mut r) = host.conn();
        let mut req = json!({ "op": "attach", "id": id });
        req.as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        s.write_all(format!("{req}\n").as_bytes()).unwrap();
        let mut line = String::new();
        r.read_line(&mut line).unwrap();
        (s, serde_json::from_str::<Value>(&line).unwrap())
    };
    let (_, refused) = attach(json!({}));
    assert_eq!(refused["code"], "lease", "{refused}");
    let (_, wrong) = attach(json!({ "lease": "t2" }));
    assert_eq!(wrong["code"], "lease", "{wrong}");
    let (_, viewer) = attach(json!({ "read_only": true }));
    assert_eq!(viewer["ok"], true, "{viewer}");
    let (mut writer, ok) = attach(json!({ "lease": "t1" }));
    assert_eq!(ok["ok"], true, "{ok}");
    writer.write_all(b"held").unwrap();
    host.wait_screen(&id, "> held");
    let moved = host.req(json!({ "op": "lease", "id": id, "current": "t1", "token": "t9" }));
    assert_eq!(moved["leased"], true, "{moved}");
    let _ = writer.write_all(b"lost");
    std::thread::sleep(Duration::from_millis(300));
    assert!(!host.screen_text(&id).contains("lost"));
}

#[test]
fn spawn_drops_the_spawners_session_markers_unless_kept() {
    let host = Host::start("scrub");
    let out = host.dir.join("env.txt");
    // Renamed into place, so the file never exists half written under a loaded test run.
    let script = format!("env > {0}.tmp && mv {0}.tmp {0}; sleep 5", out.display());
    let r = host.req(
        json!({ "op": "spawn", "argv": ["sh", "-c", script], "keep_env": ["GROK_SESSION_ID"] }),
    );
    let scrubbed: Vec<&str> = r["scrubbed"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect();
    assert!(scrubbed.contains(&"CLAUDE_CODE_CHILD_SESSION"), "{r}");
    assert!(!scrubbed.contains(&"GROK_SESSION_ID"), "{r}");
    common::wait_for("env", Duration::from_secs(5), || out.exists());
    let env = std::fs::read_to_string(&out).unwrap();
    assert!(!env.contains("CLAUDE_CODE_CHILD_SESSION="), "{env}");
    assert!(env.contains("GROK_SESSION_ID=g-1"));
    assert!(env.contains(&format!("PMCP_PTY_SESSION={}", r["id"].as_str().unwrap())));
}

fn policy(tag: &str, text: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "pmcp-pty-answers-{tag}-{}.toml",
        std::process::id()
    ));
    std::fs::write(&path, text).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
    path
}

fn at_dialog(host: &Host) -> String {
    let id = fake(host);
    let t = host.req(json!({ "op": "turn", "id": id, "text": "dialog", "timeout_ms": 10000 }));
    assert_eq!(t["outcome"], "dialog", "{t}");
    id
}

#[test]
fn answer_is_denied_without_a_policy_and_sends_only_what_the_policy_allows() {
    let none = Host::start_with("answer-none", &fixture("fake.toml"));
    let id = at_dialog(&none);
    let denied = none.req(json!({ "op": "answer", "id": id, "dialog": "exec", "option": "1" }));
    assert_eq!(denied["code"], "guard", "{denied}");

    let rules = "[[allow]]\nprofile = \"fake\"\ndialog = \"exec\"\noptions = [\"Allow once\"]\n";
    let file = policy("allow", rules);
    let host = Host::start_args(
        "answer",
        &fixture("fake.toml"),
        &[Path::new("--answers"), &file],
    );
    let id = at_dialog(&host);
    let deny = host.req(json!({ "op": "answer", "id": id, "dialog": "exec", "option": "Deny" }));
    assert_eq!(deny["code"], "guard", "{deny}");
    let wrong =
        host.req(json!({ "op": "answer", "id": id, "dialog": "auth-login", "option": "1" }));
    assert_eq!(wrong["code"], "guard", "{wrong}");
    let once = host.req(json!({ "op": "answer", "id": id, "dialog": "exec", "option": "1" }));
    assert_eq!(once["allowed"], true, "{once}");
    host.wait_screen(&id, "chose 1");
    let ops: Vec<Value> = audit(&host)
        .into_iter()
        .filter(|e| e["op"] == "answer")
        .collect();
    assert_eq!(ops.len(), 3);
    assert_eq!(ops[2]["allowed"], true);
    let _ = std::fs::remove_file(file);
}
