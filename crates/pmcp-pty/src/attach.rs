use crate::client::attach_stream;
use crate::proto::AttachReq;
use std::io::{Read, Write};
use std::path::Path;

const DETACH: u8 = 0x1c;

/// Detach is Ctrl-\ twice; a single Ctrl-\ followed by anything else is forwarded unchanged.
#[derive(Default)]
pub struct DetachFilter {
    pending: bool,
}

impl DetachFilter {
    pub fn new() -> DetachFilter {
        DetachFilter { pending: false }
    }

    pub fn feed(&mut self, input: &[u8], out: &mut Vec<u8>) -> bool {
        for &b in input {
            if b == DETACH && self.pending {
                return true;
            }
            if self.pending {
                out.push(DETACH);
                self.pending = false;
            }
            if b == DETACH {
                self.pending = true;
                continue;
            }
            out.push(b);
        }
        false
    }
}

pub fn run(
    socket: &Path,
    target: &str,
    read_only: bool,
    lease: Option<String>,
) -> Result<(), String> {
    let size = raw::size();
    let req = AttachReq {
        id: target.into(),
        cols: size.map(|s| s.0),
        rows: size.map(|s| s.1),
        read_only,
        resize: None,
        lease,
    };
    let mut stream = attach_stream(socket, req)?;
    let mut reader = stream.try_clone().map_err(|e| e.to_string())?;
    raw::enter()?;
    eprint!("\r\n[pmcp-pty] attached to {target}; detach with Ctrl-\\ Ctrl-\\\r\n");
    std::thread::spawn(move || {
        let mut stdout = std::io::stdout();
        let mut buf = [0u8; 16 * 1024];
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0
                || stdout
                    .write_all(&buf[..n])
                    .and_then(|_| stdout.flush())
                    .is_err()
            {
                break;
            }
        }
        raw::leave();
        eprint!("\r\n[pmcp-pty] session output closed\r\n");
        std::process::exit(0);
    });
    let mut stdin = std::io::stdin();
    let mut filter = DetachFilter::new();
    let mut buf = [0u8; 4096];
    let mut out = Vec::new();
    loop {
        let n = stdin.read(&mut buf).unwrap_or(0);
        if n == 0 {
            break;
        }
        out.clear();
        let detach = filter.feed(&buf[..n], &mut out);
        if stream.write_all(&out).is_err() || detach {
            break;
        }
    }
    let _ = stream.shutdown(std::net::Shutdown::Both);
    raw::leave();
    eprint!("\r\n[pmcp-pty] detached\r\n");
    Ok(())
}

#[cfg(unix)]
mod raw {
    use std::sync::Mutex;

    static SAVED: Mutex<Option<libc::termios>> = Mutex::new(None);

    pub fn enter() -> Result<(), String> {
        let mut t: libc::termios = unsafe { std::mem::zeroed() };
        if unsafe { libc::tcgetattr(0, &mut t) } != 0 {
            return Err("stdin is not a terminal".into());
        }
        *SAVED.lock().unwrap_or_else(|e| e.into_inner()) = Some(t);
        let mut raw = t;
        unsafe { libc::cfmakeraw(&mut raw) };
        unsafe { libc::tcsetattr(0, libc::TCSANOW, &raw) };
        Ok(())
    }

    pub fn leave() {
        if let Some(t) = SAVED.lock().unwrap_or_else(|e| e.into_inner()).take() {
            unsafe { libc::tcsetattr(0, libc::TCSANOW, &t) };
        }
    }

    pub fn size() -> Option<(u16, u16)> {
        let mut w: libc::winsize = unsafe { std::mem::zeroed() };
        let rc = unsafe { libc::ioctl(1, libc::TIOCGWINSZ, &mut w) };
        (rc == 0 && w.ws_col > 0 && w.ws_row > 0).then_some((w.ws_col, w.ws_row))
    }
}

#[cfg(windows)]
mod raw {
    pub fn enter() -> Result<(), String> {
        Err("attach is not implemented on Windows yet (console raw mode is untested)".into())
    }

    pub fn leave() {}

    pub fn size() -> Option<(u16, u16)> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn double_ctrl_backslash_detaches() {
        let mut f = DetachFilter::new();
        let mut out = Vec::new();
        assert!(f.feed(b"ab\x1c\x1c", &mut out));
        assert_eq!(out, b"ab");
    }

    #[test]
    fn single_ctrl_backslash_is_forwarded_across_reads() {
        let mut f = DetachFilter::new();
        let mut out = Vec::new();
        assert!(!f.feed(b"x\x1c", &mut out));
        assert!(!f.feed(b"y", &mut out));
        assert_eq!(out, b"x\x1cy");
    }
}
