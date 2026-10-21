use crossterm::event::{self, DisableBracketedPaste, EnableBracketedPaste, Event as Term};
use pmcp_tui::draw::draw;
use pmcp_tui::exec::{Exec, Mailbox};
use pmcp_tui::host::PtyHost;
use pmcp_tui::state::{App, Event, Failure};
use serde_json::json;
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Arc, mpsc};
use std::time::Duration;

const USAGE: &str =
    "usage: pmcp-tui [--socket <path>] [--host <name>] [--label k=v]... [--main <id|name>]
                [--mailbox-config <pmcp.toml> --actor-file <file>]
Shows the sessions a pmcp-pty host runs: main on the left, workers in the dock. --host keeps
the sessions of one approved [host] (label pmcp.host). The socket defaults to pmcp-pty's own
(PMCP_PTY_SOCKET, the runtime dir, on macOS a private TMPDIR dir). Ctrl-g c takes control, Ctrl-g r
gives it back, Ctrl-g ? lists the keys, Ctrl-g d leaves with every session still running.
The mailbox panel runs pmcp (PMCP_BIN, else pmcp on PATH) with an observer actor.";

// How often the session list is read again; the shown session itself streams.
const REFRESH: Duration = Duration::from_millis(1500);

struct Args {
    host: PtyHost,
    mailbox: Option<Mailbox>,
}

fn parse() -> Result<Args, String> {
    let mut args = std::env::args().skip(1);
    let mut socket = pmcp_pty::paths::default_socket();
    let (mut labels, mut main) = (BTreeMap::new(), None);
    let (mut config, mut actor) = (None, None);
    while let Some(flag) = args.next() {
        let mut value = || args.next().ok_or(format!("{flag} needs a value\n{USAGE}"));
        match flag.as_str() {
            "--socket" => socket = Some(PathBuf::from(value()?)),
            "--host" => {
                labels.insert("pmcp.host".to_string(), value()?);
            }
            "--label" => {
                let pair = value()?;
                let (k, v) = pair
                    .split_once('=')
                    .ok_or(format!("--label needs k=v\n{USAGE}"))?;
                labels.insert(k.to_string(), v.to_string());
            }
            "--main" => main = Some(value()?),
            "--mailbox-config" => config = Some(PathBuf::from(value()?)),
            "--actor-file" => actor = Some(PathBuf::from(value()?)),
            "-h" | "--help" => return Err(USAGE.into()),
            other => return Err(format!("unknown option {other}\n{USAGE}")),
        }
    }
    let socket = socket.ok_or(format!(
        "no socket: pass --socket or set XDG_RUNTIME_DIR\n{USAGE}"
    ))?;
    let pmcp = std::env::var_os("PMCP_BIN").map_or_else(|| PathBuf::from("pmcp"), PathBuf::from);
    let mailbox = match (config, actor) {
        (Some(config), Some(actor_file)) => Some(Mailbox {
            pmcp,
            config,
            actor_file,
        }),
        (None, None) => None,
        _ => {
            return Err(format!(
                "--mailbox-config and --actor-file go together\n{USAGE}"
            ));
        }
    };
    Ok(Args {
        host: PtyHost {
            socket,
            labels,
            main,
        },
        mailbox,
    })
}

fn spawn_inputs(tx: mpsc::Sender<Event>, host: Arc<PtyHost>) {
    let keys = tx.clone();
    std::thread::spawn(move || {
        while let Ok(e) = event::read() {
            let sent = match e {
                Term::Key(k) => keys.send(Event::Key(k)),
                Term::Paste(text) => keys.send(Event::Paste(text)),
                Term::Resize(cols, rows) => keys.send(Event::Resize { cols, rows }),
                _ => Ok(()),
            };
            if sent.is_err() {
                return;
            }
        }
    });
    std::thread::spawn(move || {
        loop {
            let e = match host.sessions() {
                Ok(list) => Event::Sessions(list),
                Err(why) => Event::Failed(Failure::new("list", "host_unreachable", why)),
            };
            if tx.send(e).is_err() {
                return;
            }
            std::thread::sleep(REFRESH);
        }
    });
}

fn run(args: Args) -> Result<(), String> {
    let host = Arc::new(args.host);
    let (tx, rx) = mpsc::channel::<Event>();
    spawn_inputs(tx.clone(), host.clone());
    let mut terminal = ratatui::init();
    let _ = crossterm::execute!(std::io::stdout(), EnableBracketedPaste);
    let size = terminal.size().map_err(|e| e.to_string())?;
    let mut app = App::new(size.width, size.height);
    app.mailbox_configured = args.mailbox.is_some();
    let mut exec = Exec::new(host.clone(), tx, args.mailbox.map(Arc::new));
    let result = 'outer: loop {
        if let Some(pos) = app.cursor() {
            let _ = terminal.draw(|f| {
                draw(f, &app);
                f.set_cursor_position(pos);
            });
        } else if let Err(e) = terminal.draw(|f| draw(f, &app)) {
            break Err(e.to_string());
        }
        let Ok(first) = rx.recv() else { break Ok(()) };
        // Drain what queued up, so a burst of output costs one frame.
        for e in std::iter::once(first).chain(rx.try_iter()) {
            for effect in app.update(e) {
                if !exec.run(effect) {
                    break 'outer Ok(());
                }
            }
        }
    };
    // Leaving while holding control gives the lease back, so no session stays leased to a view
    // that is gone; a crash leaves it to lapse with its 30 s lifetime.
    if let (Some(token), Some(id)) = (app.held_token(), app.target.clone()) {
        host.call(json!({ "op": "lease", "id": id, "current": token, "release": true }));
    }
    let _ = crossterm::execute!(std::io::stdout(), DisableBracketedPaste);
    ratatui::restore();
    result
}

fn main() {
    let ready =
        pmcp_pty::platform::require("pmcp-tui").map_err(|e| e.replacen("pmcp-tui: ", "", 1));
    let code = match ready.and_then(|()| parse()).and_then(run) {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("pmcp-tui: {e}");
            2
        }
    };
    std::process::exit(code);
}
