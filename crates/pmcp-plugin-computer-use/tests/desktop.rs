#![cfg(unix)]
// A real Xvfb and a fake X client written here: no agent runtime, no window manager.
use pmcp_plugin_computer_use::display::Desktop;
use pmcp_plugin_computer_use::tools::Desk;
use pmcp_plugin_support::mcp::Out;
use serde_json::json;
use std::os::unix::net::UnixStream;
use std::time::{Duration, Instant};
use x11rb::connection::Connection;
use x11rb::protocol::Event;
use x11rb::protocol::xproto::*;
use x11rb::rust_connection::{DefaultStream, RustConnection};
use x11rb::wrapper::ConnectionExt as _;

fn connect(display: u16, cookie: &[u8]) -> Result<RustConnection, String> {
    let unix =
        UnixStream::connect(format!("/tmp/.X11-unix/X{display}")).map_err(|e| e.to_string())?;
    let (stream, _) = DefaultStream::from_unix_stream(unix).map_err(|e| e.to_string())?;
    RustConnection::connect_to_stream_with_auth_info(
        stream,
        0,
        b"MIT-MAGIC-COOKIE-1".to_vec(),
        cookie.to_vec(),
    )
    .map_err(|e| e.to_string())
}

// A full-screen red window that takes focus and records what it is sent.
fn fake_client(desktop: &Desktop) -> (RustConnection, Window) {
    let conn = connect(desktop.display, &desktop.cookie).unwrap();
    let screen = conn.setup().roots[0].clone();
    let win = conn.generate_id().unwrap();
    let events = EventMask::KEY_PRESS | EventMask::BUTTON_PRESS | EventMask::EXPOSURE;
    let aux = CreateWindowAux::new()
        .background_pixel(0xff0000)
        .event_mask(events);
    let (w, h) = (desktop.width, desktop.height);
    conn.create_window(
        24,
        win,
        screen.root,
        0,
        0,
        w,
        h,
        0,
        WindowClass::INPUT_OUTPUT,
        0,
        &aux,
    )
    .unwrap();
    conn.map_window(win).unwrap();
    conn.sync().unwrap();
    conn.set_input_focus(InputFocus::PARENT, win, x11rb::CURRENT_TIME)
        .unwrap();
    conn.sync().unwrap();
    (conn, win)
}

fn events(conn: &RustConnection, until: impl Fn(&[Event]) -> bool) -> Vec<Event> {
    let mut seen = Vec::new();
    let start = Instant::now();
    while !until(&seen) && start.elapsed() < Duration::from_secs(5) {
        match conn.poll_for_event().unwrap() {
            Some(e) => seen.push(e),
            None => std::thread::sleep(Duration::from_millis(20)),
        }
    }
    seen
}

fn keysym_of(conn: &RustConnection, code: u8, shift: bool) -> u32 {
    let map = conn.get_keyboard_mapping(code, 1).unwrap().reply().unwrap();
    map.keysyms[usize::from(shift)]
}

#[test]
fn clicks_typing_and_screenshots_reach_a_real_x_client_and_strangers_are_refused() {
    let state = std::env::temp_dir().join(format!("pmcp-desktop-test-{}", std::process::id()));
    let desktop = Desktop::start(&state, 800, 600, 24).expect("Xvfb (see pmcp-desktop doctor)");
    let display = desktop.display;
    assert!(
        connect(display, &[0; 16]).is_err(),
        "a client without the cookie got in"
    );
    let (conn, _win) = fake_client(&desktop);
    let desk = Desk::new(desktop, None).unwrap();

    let Ok(Out::Image { png, note }) = desk.run("screenshot", &json!({})) else {
        panic!("no screenshot")
    };
    assert!(note.starts_with("800x600 screenshot of :"), "{note}");
    let decoder = png::Decoder::new(std::io::Cursor::new(png));
    let mut reader = decoder.read_info().unwrap();
    let mut buf = vec![0; reader.output_buffer_size().unwrap()];
    reader.next_frame(&mut buf).unwrap();
    let mid = ((300 * 800 + 400) * 3) as usize;
    assert_eq!(
        &buf[mid..mid + 3],
        [255, 0, 0],
        "the red window is not on the screenshot"
    );

    desk.run("click", &json!({ "x": 100, "y": 120 })).unwrap();
    let seen = events(&conn, |e| {
        e.iter().any(|e| matches!(e, Event::ButtonPress(_)))
    });
    let press = seen
        .iter()
        .find_map(|e| match e {
            Event::ButtonPress(b) => Some(b),
            _ => None,
        })
        .unwrap();
    assert_eq!((press.event_x, press.event_y, press.detail), (100, 120, 1));

    desk.run("type", &json!({ "text": "aA\u{D55C}" })).unwrap();
    let seen = events(&conn, |e| {
        e.iter().filter(|e| matches!(e, Event::KeyPress(_))).count() >= 4
    });
    let keys: Vec<(u8, u16)> = seen
        .iter()
        .filter_map(|e| match e {
            Event::KeyPress(k) => Some((k.detail, u16::from(k.state))),
            _ => None,
        })
        .collect();
    // a, then Shift held for A, then the Hangul syllable on a keycode bound for it.
    let typed: Vec<u32> = keys
        .iter()
        .filter(|(code, _)| keysym_of(&conn, *code, false) != 0xffe1)
        .map(|(code, state)| keysym_of(&conn, *code, state & 1 == 1))
        .collect();
    assert_eq!(
        typed,
        ['a' as u32, 'A' as u32, 0x0100_0000 | '\u{D55C}' as u32]
    );

    assert!(
        desk.run("launch", &json!({ "app": "xterm" }))
            .unwrap_err()
            .contains("no approved policy")
    );
    assert!(
        desk.run("click", &json!({ "x": 5000, "y": 1 }))
            .unwrap_err()
            .contains("off the 800x600 screen")
    );
    drop(conn);
    drop(desk);
    let socket = std::path::PathBuf::from(format!("/tmp/.X11-unix/X{display}"));
    let start = Instant::now();
    while socket.exists() && start.elapsed() < Duration::from_secs(5) {
        std::thread::sleep(Duration::from_millis(50));
    }
    assert!(!socket.exists(), "Xvfb outlived the desktop");
    let _ = std::fs::remove_dir_all(&state);
}
