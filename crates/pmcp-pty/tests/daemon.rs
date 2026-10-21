#![cfg(unix)]
mod common;

use common::{Host, fixture, spawn_bash};
use serde_json::{Value, json};
use std::io::{BufRead, Read, Write};
use std::os::unix::fs::PermissionsExt;
use std::process::Command;
use std::sync::mpsc;
use std::time::Duration;

#[test]
fn socket_is_owner_only() {
    let host = Host::start("perm");
    let mode = std::fs::metadata(&host.socket)
        .unwrap()
        .permissions()
        .mode();
    assert_eq!(mode & 0o777, 0o600);
    let again = Command::new(env!("CARGO_BIN_EXE_pmcp-pty"))
        .args(["daemon", "--socket"])
        .arg(&host.socket)
        .output()
        .unwrap();
    assert!(!again.status.success());
    assert!(String::from_utf8_lossy(&again.stderr).contains("already listening"));
}

#[test]
fn bash_renders_resizes_tails_and_reports_exit_code() {
    let host = Host::start("bash");
    let id = spawn_bash(&host, "sh1");
    let w = host.req(json!({ "op": "write", "id": id, "text": "echo hel''lo; printf '\\033]2;ptytitle\\007'", "submit": true, "guard": "none" }));
    assert_eq!(w["accepted"], true, "{w}");
    assert_eq!(w["paste"], "bracketed");
    assert_eq!(w["submitted"], true);
    assert!(w["screen_changed_within_ms"].is_u64(), "{w}");
    host.wait_screen(&id, "\nhello");
    assert_eq!(
        host.req(json!({ "op": "screen", "id": id }))["title"],
        "ptytitle"
    );

    assert_eq!(
        host.req(json!({ "op": "resize", "id": id, "cols": 100, "rows": 30 }))["ok"],
        true
    );
    host.req(
        json!({ "op": "write", "id": id, "text": "stty size", "submit": true, "guard": "none" }),
    );
    host.wait_screen(&id, "30 100");
    let screen = host.req(json!({ "op": "screen", "id": id }));
    assert_eq!(screen["size"], json!({ "cols": 100, "rows": 30 }));
    let tail = host.req(json!({ "op": "tail", "id": id, "strip": true }));
    assert!(tail["text"].as_str().unwrap().contains("30 100"));

    let busy = host.req(json!({ "op": "write", "id": id, "text": "true", "guard": "idle" }));
    assert_eq!(busy["accepted"], false);
    assert!(
        busy["reason"]
            .as_str()
            .unwrap()
            .starts_with("output not idle"),
        "{busy}"
    );
    host.wait_state(&id, "idle", |s| s["idle"] == true);
    let w = host
        .req(json!({ "op": "write", "id": id, "text": "exit 7", "submit": true, "guard": "idle" }));
    assert_eq!(w["accepted"], true, "{w}");
    let st = host.wait_state(&id, "exit", |s| s["alive"] == false);
    assert_eq!(st["exit_code"], 7);
}

#[test]
fn gemini_dialog_blocks_guarded_write_until_answered() {
    let host = Host::start("gemini");
    let argv = json!(["python3", fixture("fake_gemini.py")]);
    let r = host.req(json!({ "op": "spawn", "name": "gem", "argv": argv, "profile": "gemini", "cols": 80, "rows": 30 }));
    assert_eq!(r["profile"], "gemini", "{r}");
    let id = r["id"].as_str().unwrap().to_string();

    let (mut sub, mut sub_r) = host.conn();
    sub.write_all(format!("{}\n", json!({ "op": "subscribe", "id": id })).as_bytes())
        .unwrap();
    let (tx, rx) = mpsc::channel::<Value>();
    std::thread::spawn(move || {
        let mut line = String::new();
        while sub_r.read_line(&mut line).map(|n| n > 0).unwrap_or(false) {
            let _ = tx.send(serde_json::from_str(&line).unwrap());
            line.clear();
        }
    });

    let mut seen = Vec::new();
    wait_event(&rx, &mut seen, "dialog-appeared");
    wait_event(&rx, &mut seen, "output-idle");
    let st = host.req(json!({ "op": "state", "id": id }));
    assert_eq!(st["dialog"], "tool-confirm-exec");
    assert!(
        st["dialog_source"]
            .as_str()
            .unwrap()
            .contains("interactiveCli-66E5CZDR.js")
    );
    let refused = host.req(json!({ "op": "write", "id": id, "text": "do it", "submit": true }));
    assert_eq!(refused["accepted"], false);
    assert_eq!(refused["reason"], "dialog detected: tool-confirm-exec");
    assert_eq!(refused["code"], "dialog_open");

    assert_eq!(
        host.req(json!({ "op": "key", "id": id, "key": "Enter" }))["ok"],
        true
    );
    host.wait_screen(&id, "Type your message");
    let early =
        host.req(json!({ "op": "write", "id": id, "text": "hello gemini", "submit": true }));
    assert_eq!(early["accepted"], false);
    assert!(
        early["reason"]
            .as_str()
            .unwrap()
            .starts_with("output not idle"),
        "{early}"
    );

    let st = host.wait_state(&id, "idle input", |s| s["idle"] == true);
    assert_eq!(st["dialog"], Value::Null);
    assert_eq!(st["input_box_empty"], true);
    let ok = host.req(json!({ "op": "write", "id": id, "text": "hello gemini", "submit": true }));
    assert_eq!(ok["accepted"], true, "{ok}");
    assert_eq!(ok["paste"], "bracketed");
    assert_eq!(ok["submitted"], true);
    assert_eq!(ok["bytes"], "hello gemini".len() + 12);
    assert!(
        ok["screen_changed_within_ms"].as_u64().unwrap() < 1000,
        "{ok}"
    );

    host.wait_screen(&id, "esc to cancel");
    let during = host.req(json!({ "op": "write", "id": id, "text": "again" }));
    assert_eq!(during["accepted"], false, "{during}");
    host.wait_screen(&id, "echo: hello gemini");

    host.req(json!({ "op": "key", "id": id, "key": "C-c" }));
    let st = host.wait_state(&id, "exit", |s| s["alive"] == false);
    assert_eq!(st["exit_code"], 0);
    wait_event(&rx, &mut seen, "exit");
    for want in ["dialog-cleared", "output-active"] {
        assert!(seen.iter().any(|e| e == want), "missing {want} in {seen:?}");
    }
}

fn wait_event(rx: &mpsc::Receiver<Value>, seen: &mut Vec<String>, want: &str) {
    while !seen.iter().any(|e| e == want) {
        let e = rx
            .recv_timeout(Duration::from_secs(10))
            .unwrap_or_else(|_| panic!("no {want} event; saw {seen:?}"));
        seen.push(e["event"].as_str().unwrap_or("subscribed").to_string());
    }
}

#[test]
fn kill_and_signals_end_the_session() {
    let host = Host::start("kill");
    let r = host.req(json!({ "op": "spawn", "argv": ["sleep", "30"] }));
    let id = r["id"].as_str().unwrap().to_string();
    let running = host.req(json!({ "op": "remove", "id": id }));
    assert_eq!(
        (running["ok"].clone(), running["code"].clone()),
        (json!(false), json!("conflict"))
    );
    assert_eq!(
        host.req(json!({ "op": "kill", "id": id, "signal": "KILL" }))["ok"],
        true
    );
    let st = host.wait_state(&id, "killed", |s| s["alive"] == false);
    assert!(st["signal"].is_string(), "{st}");
    let bad = host.req(json!({ "op": "kill", "id": id, "signal": "USR9" }));
    assert_eq!(bad["ok"], false);
    assert_eq!(host.req(json!({ "op": "remove", "id": id }))["ok"], true);
    let missing = host.req(json!({ "op": "state", "id": id }));
    assert_eq!(missing["code"], "not_found");
    assert_eq!(missing["message"], format!("no session {id}"));
}

#[test]
fn two_attachers_get_repaint_and_raw_input_reaches_the_pty() {
    let host = Host::start("attach");
    let id = spawn_bash(&host, "att");
    let mut readers = Vec::new();
    let mut first = None;
    for _ in 0..2 {
        let (mut s, mut r) = host.conn();
        s.write_all(format!("{}\n", json!({ "op": "attach", "id": "att" })).as_bytes())
            .unwrap();
        let mut line = String::new();
        r.read_line(&mut line).unwrap();
        assert!(line.contains("\"attached\""), "{line}");
        readers.push(r);
        first.get_or_insert(s);
    }
    first.unwrap().write_all(b"echo via-attach\r").unwrap();
    host.wait_screen(&id, "\nvia-attach");
    for mut r in readers {
        let mut got = Vec::new();
        let mut buf = [0u8; 4096];
        r.get_mut()
            .set_read_timeout(Some(Duration::from_millis(500)))
            .unwrap();
        while let Ok(n) = r.read(&mut buf) {
            if n == 0 {
                break;
            }
            got.extend_from_slice(&buf[..n]);
            if String::from_utf8_lossy(&got).contains("via-attach") {
                break;
            }
        }
        assert!(String::from_utf8_lossy(&got).contains("via-attach"));
    }
}
