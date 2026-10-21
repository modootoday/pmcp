use crate::attach_serve::attach;
use crate::audit;
pub use crate::handler::Config;
use crate::handler::Daemon;
pub use crate::policy::Source as PolicySource;
use crate::profile::ProfileSet;
use crate::proto::Request;
use crate::transport::{self, UnixStream};
use crate::views::state;
use serde_json::{Value, json};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

pub fn run(socket: &Path, profiles: ProfileSet, config: Config) -> Result<(), String> {
    let listener = transport::bind(socket)?;
    let absolute = std::env::current_dir()
        .map(|dir| dir.join(socket))
        .unwrap_or_else(|_| socket.to_path_buf());
    let daemon = Arc::new(Daemon::new(
        profiles,
        absolute.display().to_string(),
        config,
    ));
    let socket = Arc::new(socket.to_path_buf());
    eprintln!("pmcp-pty: listening on {}", socket.display());
    for conn in listener.incoming() {
        let Ok(stream) = conn else { continue };
        if let Err(e) = transport::check_peer(&stream) {
            eprintln!("pmcp-pty: refused connection: {e}");
            continue;
        }
        let daemon = daemon.clone();
        let socket = socket.clone();
        std::thread::spawn(move || serve(stream, &daemon, &socket));
    }
    Ok(())
}

pub(crate) fn send(stream: &mut UnixStream, value: &Value) -> bool {
    let mut line = value.to_string();
    line.push('\n');
    stream.write_all(line.as_bytes()).is_ok()
}

fn serve(stream: UnixStream, daemon: &Daemon, socket: &PathBuf) {
    let Ok(mut out) = stream.try_clone() else {
        return;
    };
    let caller = audit::caller_of(&stream);
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) | Err(_) => return,
            Ok(_) => {}
        }
        if line.trim().is_empty() {
            continue;
        }
        let (req, mcp) = match crate::proto::parse_line(&line) {
            Ok(r) => r,
            Err(e) => {
                send(&mut out, &e.reply());
                continue;
            }
        };
        if mcp && let Err(e) = daemon.mcp_gate(&req) {
            let reply = e.reply();
            if let Some(entry) = audit::entry_for(&req, true) {
                daemon.audit.record(&caller, entry, &reply);
            }
            send(&mut out, &reply);
            continue;
        }
        match req {
            Request::Subscribe { id } => return subscribe(&mut out, daemon, &id),
            Request::Attach(req) => {
                let lease = req.lease.is_some();
                let entry = json!({ "op": "attach", "id": req.id, "read_only": req.read_only, "lease": lease });
                daemon.audit.record(&caller, entry, &json!({ "ok": true }));
                return attach(reader, out, daemon, req);
            }
            Request::Shutdown => {
                let reply = json!({ "ok": true });
                daemon
                    .audit
                    .record(&caller, json!({ "op": "shutdown" }), &reply);
                // The reply waits for the trees, so a caller that sees ok finds no process left.
                daemon.kill_all();
                let _ = std::fs::remove_file(socket);
                send(&mut out, &reply);
                std::process::exit(0);
            }
            other => {
                let entry = audit::entry_for(&other, mcp);
                let reply = daemon.handle(other).unwrap_or_else(|e| e.reply());
                if let Some(entry) = entry {
                    daemon.audit.record(&caller, entry, &reply);
                }
                if !send(&mut out, &reply) {
                    return;
                }
            }
        }
    }
}

fn subscribe(out: &mut UnixStream, daemon: &Daemon, id: &str) {
    let session = match daemon.find(id) {
        Ok(s) => s,
        Err(e) => {
            send(out, &e.reply());
            return;
        }
    };
    if !send(out, &json!({ "ok": true, "subscribed": session.id })) {
        return;
    }
    let mut was_idle = false;
    let mut last_dialog: Option<String> = None;
    loop {
        let st = state(&session);
        let idle = st["idle"].as_bool().unwrap_or(false);
        let dialog = st["dialog"].as_str().map(String::from);
        let mut events = Vec::new();
        if idle && !was_idle {
            events.push(json!({ "event": "output-idle", "idle_ms": st["idle_ms"] }));
        }
        if !idle && was_idle {
            events.push(json!({ "event": "output-active" }));
        }
        if dialog.is_some() && dialog != last_dialog {
            events.push(json!({ "event": "dialog-appeared", "dialog": dialog, "source": st["dialog_source"] }));
        }
        if dialog.is_none() && last_dialog.is_some() {
            events.push(json!({ "event": "dialog-cleared", "dialog": last_dialog }));
        }
        let exited = !st["alive"].as_bool().unwrap_or(true);
        if exited {
            events.push(
                json!({ "event": "exit", "exit_code": st["exit_code"], "signal": st["signal"] }),
            );
        }
        for e in &events {
            if !send(out, e) {
                return;
            }
        }
        if exited {
            return;
        }
        was_idle = idle;
        last_dialog = dialog;
        let until_idle = session
            .profile
            .idle_ms
            .saturating_sub(st["idle_ms"].as_u64().unwrap_or(0));
        let nap = match idle {
            true => 100,
            false => until_idle.clamp(1, 100),
        };
        std::thread::sleep(Duration::from_millis(nap));
    }
}
