#![cfg(unix)]
// Control through the hosted TUI: the lease, then a writable attach; while held, program input is
// refused, and giving control back frees the session again. Fake runtimes only.
mod common;

use common::Host;
use serde_json::json;

#[test]
fn a_person_takes_control_types_into_the_session_and_gives_it_back() {
    let host = Host::start("control");
    host.fake("w", "worker");
    let main = host.fake("m", "main");
    let tui = host.tui();
    host.wait_screen(&tui, "fake agent ready");
    host.press(&tui, "c");
    host.wait_screen(&tui, "CONTROL READY / INPUT ON");
    let seen = host.req(json!({ "op": "observe", "id": main }));
    assert_eq!(seen["leased"], true, "{seen}");
    // The controlled session is resized to the TUI's main pane.
    assert_eq!(seen["size"], json!({ "cols": 119, "rows": 42 }), "{seen}");
    host.type_into(&tui, "typed by a person");
    host.wait_screen(&main, "> typed by a person");
    // A program's turn is refused while the person holds the lease.
    let turn = host.req(json!({ "op": "turn", "id": main, "text": "from a program" }));
    assert_eq!(turn["code"], "lease", "{turn}");
    // A second writer without the token is refused too.
    let (code, _) = writable_attach(&host, &main);
    assert_eq!(code, "lease");
    host.press(&tui, "r");
    host.wait_screen(&tui, "MAIN m | OBSERVE / INPUT OFF");
    let seen = host.req(json!({ "op": "observe", "id": main }));
    assert_eq!(seen["leased"], false, "{seen}");
    // History is the session's transcript, shown without typing anything.
    host.press(&tui, "h");
    host.wait_screen(&tui, "OWNED HISTORY");
    host.key(&tui, "q");
    host.wait_screen(&tui, "fake agent ready");
    // Leaving while in control gives the lease back before the TUI exits.
    host.press(&tui, "c");
    host.wait_screen(&tui, "CONTROL READY / INPUT ON");
    host.press(&tui, "d");
    let gone = host.req(json!({ "op": "wait", "id": tui, "until": ["exit"], "timeout_ms": 10000 }));
    assert_eq!(gone["fired"], "exit", "{gone}");
    let seen = host.req(json!({ "op": "observe", "id": main }));
    assert_eq!(
        (seen["leased"].clone(), seen["alive"].clone()),
        (json!(false), json!(true)),
        "{seen}"
    );
}

fn writable_attach(host: &Host, id: &str) -> (String, serde_json::Value) {
    use std::io::{BufRead, BufReader, Write};
    let mut s = std::os::unix::net::UnixStream::connect(&host.socket).unwrap();
    s.write_all(format!("{}\n", json!({ "op": "attach", "id": id })).as_bytes())
        .unwrap();
    let mut line = String::new();
    BufReader::new(s).read_line(&mut line).unwrap();
    let v: serde_json::Value = serde_json::from_str(&line).unwrap();
    (v["code"].as_str().unwrap_or("ok").to_string(), v)
}
