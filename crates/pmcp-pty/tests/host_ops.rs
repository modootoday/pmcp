#![cfg(unix)]
mod common;

use common::{Host, fixture, spawn_bash, wait_for};
use serde_json::{Value, json};
use std::io::{BufRead, Write};
use std::process::Command;
use std::time::Duration;

fn fake(host: &Host) -> String {
    let argv = json!(["python3", fixture("fake_agent.py")]);
    let r =
        host.req(json!({ "op": "spawn", "argv": argv, "profile": "fake", "cols": 80, "rows": 24 }));
    let id = r["id"].as_str().unwrap().to_string();
    let idle = host.req(json!({ "op": "wait", "id": id, "until": ["idle"], "timeout_ms": 10000 }));
    assert_eq!(idle["fired"], "idle", "{idle}");
    id
}

fn size(host: &Host, id: &str) -> serde_json::Value {
    host.req(json!({ "op": "screen", "id": id }))["size"].clone()
}

#[test]
fn a_sized_attach_resizes_until_the_last_one_leaves_and_read_only_cannot_type() {
    let host = Host::start("attach-size");
    let id = spawn_bash(&host, "sized");
    assert_eq!(size(&host, &id), json!({ "cols": 80, "rows": 24 }));
    // A read-only viewer leaves the size alone unless it asks; the live check saw a viewer
    // window reflow a session to about 380 columns.
    let (mut quiet, mut quiet_r) = host.conn();
    let look = json!({ "op": "attach", "id": id, "cols": 380, "rows": 50, "read_only": true });
    quiet.write_all(format!("{look}\n").as_bytes()).unwrap();
    let mut line = String::new();
    quiet_r.read_line(&mut line).unwrap();
    assert_eq!(size(&host, &id), json!({ "cols": 80, "rows": 24 }));

    let (mut viewer, mut viewer_r) = host.conn();
    let attach = json!({ "op": "attach", "id": id, "cols": 100, "rows": 30, "read_only": true, "resize": true });
    viewer.write_all(format!("{attach}\n").as_bytes()).unwrap();
    line.clear();
    viewer_r.read_line(&mut line).unwrap();
    assert!(line.contains("\"read_only\":true"), "{line}");
    assert_eq!(size(&host, &id), json!({ "cols": 100, "rows": 30 }));

    let listed = host.req(json!({ "op": "attachers", "id": id }));
    let attachers = listed["attachers"].as_array().unwrap();
    assert_eq!(attachers.len(), 2, "{listed}");
    assert_eq!(attachers[0]["size"], Value::Null);
    assert_eq!(attachers[1]["read_only"], true);
    assert_eq!(attachers[1]["pid"], std::process::id());
    assert_eq!(attachers[1]["size"], json!({ "cols": 100, "rows": 30 }));

    viewer.write_all(b"echo typed-by-viewer\r").unwrap();
    std::thread::sleep(Duration::from_millis(300));
    assert!(!host.screen_text(&id).contains("typed-by-viewer"));

    assert_eq!(host.req(json!({ "op": "detach", "id": id }))["detached"], 2);
    wait_for("size restored", Duration::from_secs(5), || {
        size(&host, &id) == json!({ "cols": 80, "rows": 24 })
    });
    wait_for("attacher gone", Duration::from_secs(5), || {
        host.req(json!({ "op": "attachers", "id": id }))["attachers"] == json!([])
    });
}

#[test]
fn record_writes_a_fixture_that_check_replays_and_a_changed_one_fails() {
    let host = Host::start_with("record", &fixture("fake.toml"));
    let id = fake(&host);
    let bad = host.req(json!({ "op": "record", "id": id, "label": "../escape" }));
    assert_eq!(bad["code"], "bad_request");
    let rec = host.req(json!({ "op": "record", "id": id, "label": "idle-prompt" }));
    assert_eq!(rec["ok"], true, "{rec}");
    assert_eq!(rec["expect"]["input_empty"], true);
    let root = host.dir.join("fixtures");
    let check = || {
        Command::new(env!("CARGO_BIN_EXE_pmcp-pty"))
            .args(["profiles", "--profiles"])
            .arg(fixture("fake.toml"))
            .arg("--check")
            .arg(&root)
            .output()
            .unwrap()
    };
    let ok = check();
    assert!(ok.status.success(), "{ok:?}");
    assert!(String::from_utf8_lossy(&ok.stdout).contains("ok fake/idle-prompt"));

    let expect = root.join("fake/idle-prompt/expect.json");
    let text = std::fs::read_to_string(&expect).unwrap();
    std::fs::write(
        &expect,
        text.replace("\"input_empty\": true", "\"input_empty\": false"),
    )
    .unwrap();
    let failed = check();
    assert!(!failed.status.success());
    assert!(String::from_utf8_lossy(&failed.stdout).contains("FAIL fake/idle-prompt"));
}

#[test]
fn version_drift_is_observed_and_a_dialog_left_on_screen_still_refuses() {
    let host = Host::start_with("drift", &fixture("fake.toml"));
    let id = fake(&host);
    wait_for("version detected", Duration::from_secs(10), || {
        host.req(json!({ "op": "observe", "id": id }))["version"].is_string()
    });
    let seen = host.req(json!({ "op": "observe", "id": id }));
    assert_eq!(seen["profile_version"], "fake 1.0");
    let warning = seen["version_warning"].as_str().unwrap();
    assert!(
        warning.starts_with("profile read from fake 1.0, running Python 3."),
        "{warning}"
    );

    let t =
        host.req(json!({ "op": "turn", "id": id, "text": "stale-dialog", "timeout_ms": 10000 }));
    assert_eq!(t["outcome"], "dialog", "{t}");
    let refused = host.req(json!({ "op": "turn", "id": id, "text": "anything" }));
    assert_eq!(refused["outcome"], "refused", "{refused}");
    assert_eq!(refused["code"], "dialog_open");
}

// An empty Enter makes the fake work for half a second, like a hook that runs on its own.
#[test]
fn wait_idle_ms_spares_the_caller_a_retry_while_the_runtime_is_briefly_busy() {
    let host = Host::start_with("wait-idle", &fixture("fake.toml"));
    let id = fake(&host);
    host.req(json!({ "op": "key", "id": id, "key": "Enter" }));
    // The turn must find the fake busy, not race it before it draws its busy row.
    wait_for("busy row", Duration::from_secs(5), || {
        !host.req(json!({ "op": "observe", "id": id }))["busy"].is_null()
    });
    let refused = host.req(json!({ "op": "turn", "id": id, "text": "too soon" }));
    assert_eq!(
        (refused["outcome"].clone(), refused["code"].clone()),
        (json!("refused"), json!("busy")),
        "{refused}"
    );
    host.req(json!({ "op": "wait", "id": id, "until": ["idle"], "timeout_ms": 10000 }));
    host.req(json!({ "op": "key", "id": id, "key": "Enter" }));
    let waited = host.req(json!({ "op": "turn", "id": id, "text": "after the wait", "wait_idle_ms": 10000, "timeout_ms": 10000 }));
    assert_eq!(waited["outcome"], "completed", "{waited}");
    assert_eq!(waited["reply"], "echo: after the wait\nsecond line");
}
