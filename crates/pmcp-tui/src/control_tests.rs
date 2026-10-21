use crate::state::{App, Effect, Event, Failure, Panel, Phase};
use crate::state_tests::{attach, keys, screen, session};

fn controlled() -> App {
    let mut app = App::new(160, 48);
    app.update(Event::Sessions(vec![
        session("m", true, true),
        session("w1", false, true),
    ]));
    assert_eq!(
        keys(&mut app, "^c"),
        vec![Effect::Acquire { id: "m".into() }]
    );
    assert_eq!(app.phase, Phase::Acquiring);
    let effects = app.update(Event::Leased { token: "t".into() });
    let writable = Effect::Attach {
        id: "m".into(),
        serial: 2,
        read_only: false,
        size: Some((119, 42)),
        lease: Some("t".into()),
    };
    assert_eq!(effects, vec![Effect::Detach { serial: 1 }, writable]);
    assert_eq!(app.phase, Phase::Connecting);
    // Typing waits for pmcp-pty to accept the writable attach.
    assert!(keys(&mut app, "x").is_empty());
    app.update(Event::Writable { serial: 2 });
    assert_eq!(app.phase, Phase::Controlled);
    app
}

#[test]
fn control_is_the_lease_then_a_writable_attach_and_keys_flow_only_then() {
    let mut app = controlled();
    assert_eq!(
        keys(&mut app, "hi"),
        vec![
            Effect::Input {
                serial: 2,
                bytes: b"h".to_vec()
            },
            Effect::Input {
                serial: 2,
                bytes: b"i".to_vec()
            },
        ]
    );
    let paste = app.update(Event::Paste("a\nb".into()));
    assert_eq!(
        paste,
        vec![Effect::Input {
            serial: 2,
            bytes: b"a\rb".to_vec()
        }]
    );
    assert!(screen(&app, 160, 48).contains("CONTROL READY / INPUT ON"));
    // The lease is renewed every sixth list refresh while held.
    let renewals: usize = (0..12)
        .map(|_| app.update(Event::Sessions(app.sessions.clone())).len())
        .sum();
    assert_eq!(renewals, 2);
    // A terminal resize resizes the controlled session to the new pane.
    let resized = app.update(Event::Resize {
        cols: 100,
        rows: 30,
    });
    assert_eq!(
        resized,
        vec![Effect::ResizePty {
            id: "m".into(),
            cols: 100,
            rows: 29
        }]
    );
}

#[test]
fn leaving_gives_control_back_first_and_then_runs_the_action() {
    let mut app = controlled();
    let effects = keys(&mut app, "^1");
    let release = Effect::Release {
        id: "m".into(),
        token: "t".into(),
    };
    assert_eq!(effects, vec![Effect::Detach { serial: 2 }, release]);
    assert_eq!(app.phase, Phase::Releasing);
    assert!(keys(&mut app, "x").is_empty());
    let after = app.update(Event::Released);
    assert_eq!(
        after,
        vec![
            attach("m", 3),
            Effect::Detach { serial: 3 },
            attach("w1", 4)
        ]
    );
    assert_eq!((app.phase, app.held_token()), (Phase::ReadOnly, None));
}

#[test]
fn a_failed_release_is_control_unknown_and_blocks_input_until_retried() {
    let mut app = controlled();
    keys(&mut app, "^r");
    app.update(Event::ReleaseFailed(Failure::new(
        "release", "lease", "taken",
    )));
    assert_eq!(app.phase, Phase::Uncertain);
    assert!(keys(&mut app, "typed").is_empty());
    keys(&mut app, "^m");
    assert_eq!(app.failure.as_ref().unwrap().code, "control_unknown");
    assert!(screen(&app, 160, 48).contains("CONTROL UNKNOWN / INPUT OFF"));
    let retry = keys(&mut app, "^r");
    assert_eq!(
        retry,
        vec![Effect::Release {
            id: "m".into(),
            token: "t".into()
        }]
    );
}

#[test]
fn a_busy_session_or_a_refused_attach_leaves_the_view_read_only() {
    let mut app = App::new(160, 48);
    app.update(Event::Sessions(vec![session("m", true, true)]));
    keys(&mut app, "^c");
    let busy = Failure::new("control", "target_busy", "mid-turn");
    // No lease was taken, so nothing is released; the read-only view comes back.
    assert_eq!(app.update(Event::ControlFailed(busy)), vec![attach("m", 2)]);
    assert_eq!(app.phase, Phase::ReadOnly);
    let mut app = controlled();
    let refused = Failure::new("attach", "attach_refused", "lease");
    let effects = app.update(Event::ControlFailed(refused));
    assert_eq!(
        effects,
        vec![
            Effect::Detach { serial: 2 },
            Effect::Release {
                id: "m".into(),
                token: "t".into()
            }
        ]
    );
    // A writer that drops while controlling also gives the lease back.
    let mut app = controlled();
    let lost = app.update(Event::Closed { serial: 2 });
    assert_eq!(
        lost,
        vec![Effect::Release {
            id: "m".into(),
            token: "t".into()
        }]
    );
    assert_eq!(app.failure.as_ref().unwrap().code, "writer_lost");
}

#[test]
fn history_and_mailbox_panels_scroll_and_return_without_typing() {
    let mut app = App::new(100, 30);
    app.update(Event::Sessions(vec![session("m", true, true)]));
    assert_eq!(
        keys(&mut app, "^h"),
        vec![Effect::ReadHistory { id: "m".into() }]
    );
    let text: String = (0..3000).map(|i| format!("line {i}\n")).collect();
    app.update(Event::History {
        id: "m".into(),
        text,
    });
    assert_eq!(app.panel, Panel::History);
    assert_eq!(app.history.len(), 2001, "2000 lines and the header");
    assert!(screen(&app, 100, 30).contains("line 2999"));
    keys(&mut app, "q");
    assert_eq!(app.panel, Panel::Native);
    keys(&mut app, "^b");
    assert_eq!(app.failure.as_ref().unwrap().code, "mailbox_not_configured");
    app.mailbox_configured = true;
    assert_eq!(keys(&mut app, "^b"), vec![Effect::ReadMailbox]);
    app.update(Event::Mailbox(Some(vec!["m1 thread=t1 reply=none".into()])));
    let shown = screen(&app, 100, 30);
    assert!(shown.contains("MAILBOX / metadata only") && shown.contains("m1 thread=t1"));
    assert!(keys(&mut app, "x").is_empty());
}
