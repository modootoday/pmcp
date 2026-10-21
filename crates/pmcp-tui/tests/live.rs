#![cfg(unix)]
// pmcp-tui against a real pmcp-pty daemon and the fake agent; the second test has pmcp-pty host
// the TUI itself, so a real PTY drives it without a terminal.
mod common;

use common::{Host, wait};
use serde_json::json;
use std::time::Duration;

#[test]
fn the_host_adapter_lists_main_first_and_streams_the_shown_session() {
    use pmcp_tui::host::PtyHost;
    use pmcp_tui::state::{App, Effect, Event};
    let host = Host::start("adapter");
    let worker = host.fake("w", "worker");
    let main = host.fake("m", "main");
    let pty = PtyHost {
        socket: host.socket.clone(),
        labels: [("pmcp.host".to_string(), "t".to_string())].into(),
        main: None,
    };
    let list = pty.sessions().unwrap();
    let mains: Vec<_> = list
        .iter()
        .filter(|s| s.main)
        .map(|s| s.id.clone())
        .collect();
    assert_eq!(mains, vec![main.clone()]);
    assert!(
        list.iter()
            .any(|s| s.id == worker && s.runtime == "fake" && s.cols == 60)
    );
    let mut app = App::new(160, 48);
    let effects = app.update(Event::Sessions(list));
    let Some(Effect::Attach {
        id,
        serial,
        read_only,
        size,
        lease,
    }) = effects.into_iter().next()
    else {
        panic!("main was not attached");
    };
    assert!(read_only && id == main && size.is_none() && lease.is_none());
    let (tx, rx) = std::sync::mpsc::channel();
    let stream = pty.attach(&id, serial, true, None, None, tx).unwrap();
    wait("repaint", || {
        for e in rx.try_iter() {
            app.update(e);
        }
        let text = app.parser.as_ref().unwrap().screen().contents();
        text.contains("fake agent ready")
    });
    drop(stream);
}

#[test]
fn pmcp_pty_hosts_the_tui_which_shows_main_switches_to_a_worker_and_detaches() {
    let host = Host::start("e2e");
    let worker = host.fake("w", "worker");
    let main = host.fake("m", "main");
    let typed = host
        .req(json!({ "op": "turn", "id": worker, "text": "from the worker", "timeout_ms": 10000 }));
    assert_eq!(typed["outcome"], "completed", "{typed}");
    let tui = host.tui();
    let first = host.wait_screen(&tui, "fake agent ready");
    assert!(first.contains("MAIN m | OBSERVE / INPUT OFF"), "{first}");
    host.press(&tui, "1");
    let shown = host.wait_screen(&tui, "echo: from the worker");
    assert!(shown.contains("WORKER w | OBSERVE / INPUT OFF"), "{shown}");
    // Typing into the view reaches no session while it is read-only.
    host.type_into(&tui, "should not arrive");
    std::thread::sleep(Duration::from_millis(500));
    assert!(!host.screen(&worker).contains("should not arrive"));
    host.press(&tui, "d");
    let gone = host.req(json!({ "op": "wait", "id": tui, "until": ["exit"], "timeout_ms": 10000 }));
    assert_eq!(gone["fired"], "exit", "{gone}");
    for id in [&main, &worker] {
        assert_eq!(
            host.req(json!({ "op": "observe", "id": id }))["alive"],
            true
        );
    }
}
