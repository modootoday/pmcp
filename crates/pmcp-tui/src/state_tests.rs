use crate::draw::draw;
use crate::state::{App, Effect, Event, Panel, SessionInfo};
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use ratatui::Terminal;
use ratatui::backend::TestBackend;

pub(crate) fn session(id: &str, main: bool, alive: bool) -> SessionInfo {
    SessionInfo {
        id: id.into(),
        name: format!("n-{id}"),
        runtime: "fake".into(),
        status: "idle".into(),
        alive,
        cols: 30,
        rows: 6,
        main,
    }
}

pub(crate) fn keys(app: &mut App, text: &str) -> Vec<Effect> {
    let mut out = Vec::new();
    for c in text.chars() {
        let k = match c {
            '^' => KeyEvent::new(KeyCode::Char('g'), KeyModifiers::CONTROL),
            c => KeyEvent::new(KeyCode::Char(c), KeyModifiers::NONE),
        };
        out.extend(app.update(Event::Key(k)));
    }
    out
}

pub(crate) fn screen(app: &App, cols: u16, rows: u16) -> String {
    let mut t = Terminal::new(TestBackend::new(cols, rows)).unwrap();
    t.draw(|f| draw(f, app)).unwrap();
    let buf = t.backend().buffer();
    // As a terminal shows it: the cell after a wide (Hangul) character is its right half.
    let row = |y: u16| {
        let mut out = String::new();
        let mut skip = false;
        for x in 0..cols {
            let symbol = buf[(x, y)].symbol();
            if std::mem::take(&mut skip) {
                continue;
            }
            skip = symbol
                .chars()
                .any(|c| ('\u{ac00}'..='\u{d7a3}').contains(&c));
            out.push_str(symbol);
        }
        out
    };
    (0..rows).map(row).collect::<Vec<_>>().join("\n")
}

pub(crate) fn attach(id: &str, serial: u64) -> Effect {
    Effect::Attach {
        id: id.into(),
        serial,
        read_only: true,
        size: None,
        lease: None,
    }
}

#[test]
fn main_is_attached_first_and_workers_switch_with_one_attach_each() {
    let mut app = App::new(160, 48);
    let list = vec![
        session("m", true, true),
        session("w1", false, true),
        session("w2", false, true),
    ];
    assert_eq!(
        app.update(Event::Sessions(list.clone())),
        vec![attach("m", 1)]
    );
    // The same list again changes nothing.
    assert!(app.update(Event::Sessions(list)).is_empty());
    assert_eq!(
        keys(&mut app, "^2"),
        vec![Effect::Detach { serial: 1 }, attach("w2", 2)]
    );
    assert_eq!(
        keys(&mut app, "^w"),
        vec![Effect::Detach { serial: 2 }, attach("w1", 3)]
    );
    assert_eq!(
        keys(&mut app, "^m"),
        vec![Effect::Detach { serial: 3 }, attach("m", 4)]
    );
    assert!(keys(&mut app, "^9").is_empty());
    assert_eq!(app.failure.as_ref().unwrap().code, "worker_unavailable");
    keys(&mut app, "^!");
    assert!(app.failure.is_none());
    assert_eq!(keys(&mut app, "^d"), vec![Effect::Quit]);
}

#[test]
fn output_from_an_old_attach_is_dropped_and_a_dead_worker_returns_to_main() {
    let mut app = App::new(160, 48);
    app.update(Event::Sessions(vec![
        session("m", true, true),
        session("w1", false, true),
    ]));
    keys(&mut app, "^1");
    app.update(Event::Output {
        serial: 1,
        bytes: b"from main".to_vec(),
    });
    app.update(Event::Output {
        serial: 2,
        bytes: b"from worker".to_vec(),
    });
    let text = app.parser.as_ref().unwrap().screen().contents();
    assert!(
        text.contains("from worker") && !text.contains("from main"),
        "{text}"
    );
    let effects = app.update(Event::Sessions(vec![
        session("m", true, true),
        session("w1", false, false),
    ]));
    assert_eq!(effects, vec![Effect::Detach { serial: 2 }, attach("m", 3)]);
    // A closed stream is attached again on the next list while the session lives.
    app.update(Event::Closed { serial: 3 });
    let again = app.update(Event::Sessions(vec![session("m", true, true)]));
    assert_eq!(again, vec![attach("m", 4)]);
}

#[test]
fn keys_for_the_session_go_nowhere_while_read_only() {
    let mut app = App::new(160, 48);
    app.update(Event::Sessions(vec![session("m", true, true)]));
    assert!(keys(&mut app, "hello").is_empty());
    keys(&mut app, "^n");
    assert_eq!(
        app.failure.as_ref().unwrap().code,
        "unsupported_view_operation"
    );
}

#[test]
fn split_compact_and_tiny_terminals_render() {
    let mut app = App::new(160, 48);
    app.update(Event::Sessions(vec![
        session("m", true, true),
        session("w1", false, true),
    ]));
    app.update(Event::Output {
        serial: 1,
        bytes: "› \u{C548}\u{B155} main".as_bytes().to_vec(),
    });
    let split = screen(&app, 160, 48);
    assert!(split.contains("› \u{C548}\u{B155} main"), "{split}");
    assert!(split.contains("WORKERS / observe only") && split.contains(" 1. fake n-w1 idle"));
    assert!(split.contains("TARGET MAIN n-m | OBSERVE / INPUT OFF"));
    assert!(
        split
            .lines()
            .last()
            .unwrap()
            .starts_with("MAIN n-m | OBSERVE / INPUT OFF")
    );

    let compact = screen(&app, 100, 30);
    assert!(compact.contains("› \u{C548}\u{B155} main") && !compact.contains("WORKERS"));
    keys(&mut app, "^g");
    assert_eq!(app.panel, Panel::Management);
    let management = screen(&app, 100, 30);
    assert!(management.contains("WORKERS") && management.contains("TARGET MAIN"));
    keys(&mut app, "^?");
    assert!(screen(&app, 100, 30).contains("m main; n add worker"));

    let tiny = screen(&app, 39, 11);
    assert!(
        tiny.contains("terminal is 39x11") && tiny.contains("at least 40x12"),
        "{tiny}"
    );
}
