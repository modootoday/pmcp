#![cfg(unix)]
mod common;

use common::{Host, fixture};
use serde_json::{Value, json};
use std::os::unix::fs::PermissionsExt;
use std::path::Path;

fn fake(host: &Host) -> String {
    let argv = json!(["python3", fixture("fake_agent.py")]);
    let r =
        host.req(json!({ "op": "spawn", "argv": argv, "profile": "fake", "cols": 80, "rows": 24 }));
    let id = r["id"].as_str().unwrap().to_string();
    host.req(json!({ "op": "wait", "id": id, "until": ["idle"], "timeout_ms": 10000 }));
    id
}

fn mcp(host: &Host, mut v: Value) -> Value {
    v["via"] = json!("mcp");
    host.req(v)
}

#[test]
fn describe_lists_every_op_and_mcp_reaches_only_reads_without_the_operator() {
    let host = Host::start_with("mcp-read", &fixture("fake.toml"));
    let d = host.req(json!({ "op": "describe" }));
    assert_eq!(d["ops"].as_array().unwrap().len(), 24, "{d}");
    assert_eq!(d["policy"]["mcp_write"], false);
    assert!(
        d["profiles"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p["name"] == "fake")
    );
    let id = fake(&host);
    assert_eq!(
        mcp(&host, json!({ "op": "observe", "id": id }))["status"],
        "idle"
    );
    let turn = mcp(&host, json!({ "op": "turn", "id": id, "text": "hi" }));
    assert_eq!(turn["code"], "guard", "{turn}");
    for op in [
        json!({ "op": "answer", "id": id, "dialog": "exec", "option": "1" }),
        json!({ "op": "write", "id": id, "text": "x" }),
        json!({ "op": "shutdown" }),
    ] {
        let r = mcp(&host, op);
        assert!(
            r["message"]
                .as_str()
                .unwrap()
                .contains("not available over MCP"),
            "{r}"
        );
    }
    let text = std::fs::read_to_string(host.socket.with_extension("audit.jsonl")).unwrap();
    let via: Vec<Value> = text
        .lines()
        .map(|l| serde_json::from_str::<Value>(l).unwrap())
        .filter(|e| e["via"] == "mcp")
        .collect();
    let ops: Vec<&str> = via.iter().map(|e| e["op"].as_str().unwrap()).collect();
    assert_eq!(
        ops,
        ["observe", "turn", "answer", "write", "shutdown"],
        "{text}"
    );
}

#[test]
fn mcp_write_in_the_operator_policy_opens_turn_and_lease_but_never_answer() {
    let path = std::env::temp_dir().join(format!("pmcp-pty-mcp-{}.toml", std::process::id()));
    std::fs::write(&path, "mcp_write = true\n").unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
    let host = Host::start_args(
        "mcp-write",
        &fixture("fake.toml"),
        &[Path::new("--answers"), &path],
    );
    assert_eq!(
        host.req(json!({ "op": "describe" }))["policy"]["mcp_write"],
        true
    );
    let id = fake(&host);
    let turn = mcp(
        &host,
        json!({ "op": "turn", "id": id, "text": "hi", "timeout_ms": 10000 }),
    );
    assert_eq!(turn["outcome"], "completed", "{turn}");
    let lease = mcp(&host, json!({ "op": "lease", "id": id, "token": "m1" }));
    assert_eq!(lease["leased"], true, "{lease}");
    let answer = mcp(
        &host,
        json!({ "op": "answer", "id": id, "dialog": "exec", "option": "1" }),
    );
    assert_eq!(answer["code"], "guard", "{answer}");
    let _ = std::fs::remove_file(path);
}
