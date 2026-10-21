use crate::daemon::send;
use crate::error::{Code, Fail};
use crate::handler::Daemon;
use crate::proto::AttachReq;
use crate::session::Session;
use crate::transport::{self, UnixStream};
use serde_json::json;
use std::io::{BufReader, Read, Write};
use std::sync::mpsc;

// While a session is leased, a writable attach needs the lease token like any other input: a
// read-only viewer is always welcome, a second writer is refused instead of typing over the holder.
pub fn attach(
    mut reader: BufReader<UnixStream>,
    mut out: UnixStream,
    daemon: &Daemon,
    req: AttachReq,
) {
    let session = match daemon.find(&req.id) {
        Ok(s) => s,
        Err(e) => {
            send(&mut out, &e.reply());
            return;
        }
    };
    if !req.read_only
        && let Err(e) = daemon.leases.check(&session.id, req.lease.as_deref())
    {
        send(&mut out, &e.reply());
        return;
    }
    let Ok(handle) = out.try_clone() else {
        return;
    };
    let size = req
        .cols
        .zip(req.rows)
        .filter(|_| req.resize.unwrap_or(!req.read_only));
    let pid = transport::peer_pid(&out);
    let joined = daemon
        .attached
        .join(&session, handle, pid, req.read_only, size);
    let (tx, rx) = mpsc::channel::<Vec<u8>>();
    let repaint = match session.add_attacher(tx) {
        Ok(r) => r,
        Err(e) => {
            daemon.attached.leave(&session, joined.serial);
            send(&mut out, &Fail::new(Code::Exited, e).reply());
            return;
        }
    };
    let reply = json!({ "ok": true, "attached": session.id, "read_only": req.read_only });
    if !send(&mut out, &reply) {
        daemon.attached.leave(&session, joined.serial);
        return;
    }
    let mut writer = match out.try_clone() {
        Ok(w) => w,
        Err(_) => return,
    };
    std::thread::spawn(move || {
        if writer.write_all(&repaint).is_err() {
            return;
        }
        for chunk in rx {
            if writer.write_all(&chunk).is_err() {
                break;
            }
        }
        let _ = writer.shutdown(std::net::Shutdown::Both);
    });
    pump_input(&mut reader, &session, &req, daemon);
    daemon.attached.leave(&session, joined.serial);
    let _ = out.shutdown(std::net::Shutdown::Both);
}

// A read-only attacher's keystrokes are read and dropped, so it can never type into the session.
// A writable attacher's keystrokes mark a person at the keyboard, whom program input then waits for;
// they stop the moment someone else holds the lease, and the attach is closed.
fn pump_input(
    reader: &mut BufReader<UnixStream>,
    session: &Session,
    req: &AttachReq,
    daemon: &Daemon,
) {
    let mut buf = [0u8; 4096];
    loop {
        let n = match reader.read(&mut buf) {
            Ok(0) | Err(_) => return,
            Ok(n) => n,
        };
        if req.read_only {
            continue;
        }
        if daemon
            .leases
            .check(&session.id, req.lease.as_deref())
            .is_err()
        {
            return;
        }
        daemon.attached.typed(&session.id);
        if session.write_raw(&buf[..n]).is_err() {
            return;
        }
    }
}
