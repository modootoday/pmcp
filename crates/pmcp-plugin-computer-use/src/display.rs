use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

// The desktop owns one display between :90 and :99, so it never lands on an operator's own X
// server. A random MIT cookie in an owner-only Xauthority file keeps other local users out.
pub const FIRST: u16 = 90;
pub const LAST: u16 = 99;

pub struct Desktop {
    pub display: u16,
    pub width: u16,
    pub height: u16,
    pub xauthority: PathBuf,
    pub cookie: [u8; 16],
    xvfb: Child,
}

fn taken(n: u16) -> bool {
    Path::new(&format!("/tmp/.X{n}-lock")).exists()
        || Path::new(&format!("/tmp/.X11-unix/X{n}")).exists()
}

pub fn free_display() -> Option<u16> {
    (FIRST..=LAST).find(|n| !taken(*n))
}

fn cookie() -> Result<[u8; 16], String> {
    let mut bytes = [0u8; 16];
    File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(&mut bytes))
        .map_err(|e| format!("/dev/urandom: {e}"))?;
    Ok(bytes)
}

fn field(out: &mut Vec<u8>, data: &[u8]) {
    out.extend((data.len() as u16).to_be_bytes());
    out.extend(data);
}

// One FamilyWild entry, so the cookie works whatever hostname the client resolves.
pub fn xauthority_entry(display: u16, cookie: &[u8]) -> Vec<u8> {
    let mut out = 0xffffu16.to_be_bytes().to_vec();
    field(&mut out, b"");
    field(&mut out, display.to_string().as_bytes());
    field(&mut out, b"MIT-MAGIC-COOKIE-1");
    field(&mut out, cookie);
    out
}

fn write_private(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut f = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
        .map_err(|e| format!("{}: {e}", path.display()))?;
    f.write_all(bytes).map_err(|e| e.to_string())
}

impl Desktop {
    /// Starts Xvfb on a free display, as this process's child, and waits for its socket.
    pub fn start(state: &Path, width: u16, height: u16, depth: u8) -> Result<Desktop, String> {
        let display = free_display().ok_or("no free display between :90 and :99")?;
        std::fs::create_dir_all(state).map_err(|e| e.to_string())?;
        let xauthority = state.join(format!("Xauthority-{display}"));
        let _ = std::fs::remove_file(&xauthority);
        let cookie = cookie()?;
        write_private(&xauthority, &xauthority_entry(display, &cookie))?;
        let xvfb = Command::new("Xvfb")
            .arg(format!(":{display}"))
            .args(["-screen", "0", &format!("{width}x{height}x{depth}")])
            .args(["-nolisten", "tcp", "-auth"])
            .arg(&xauthority)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Xvfb: {e}; see pmcp-desktop doctor"))?;
        let desktop = Desktop {
            display,
            width,
            height,
            xauthority,
            cookie,
            xvfb,
        };
        let socket = PathBuf::from(format!("/tmp/.X11-unix/X{display}"));
        let start = Instant::now();
        while !socket.exists() {
            if start.elapsed() > Duration::from_secs(10) {
                return Err(format!("Xvfb did not open :{display} within 10 s"));
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        Ok(desktop)
    }

    pub fn name(&self) -> String {
        format!(":{}", self.display)
    }

    /// The environment a client of this desktop needs.
    pub fn env(&self) -> [(String, String); 2] {
        [
            ("DISPLAY".into(), self.name()),
            ("XAUTHORITY".into(), self.xauthority.display().to_string()),
        ]
    }
}

impl Drop for Desktop {
    // TERM first: an X server resets on HUP, and only a TERM lets it remove its own socket and
    // lock. Whatever is left after that goes the shared way, HUP then KILL; files a killed
    // Xvfb leaves are ours to remove, or the display stays taken for every later start.
    fn drop(&mut self) {
        let pid = self.xvfb.id();
        unsafe { libc::kill(pid as i32, libc::SIGTERM) };
        let start = Instant::now();
        while start.elapsed() < Duration::from_secs(2) {
            if matches!(self.xvfb.try_wait(), Ok(Some(_))) {
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        pmcp_plugin_support::reap::terminate(&[pid], pmcp_plugin_support::reap::GRACE);
        let _ = self.xvfb.wait();
        let lock = format!("/tmp/.X{}-lock", self.display);
        let ours = std::fs::read_to_string(&lock).is_ok_and(|text| text.trim() == pid.to_string());
        if ours {
            let _ = std::fs::remove_file(&lock);
            let _ = std::fs::remove_file(format!("/tmp/.X11-unix/X{}", self.display));
        }
        let _ = std::fs::remove_file(&self.xauthority);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_xauthority_entry_is_family_wild_with_the_display_and_cookie() {
        let e = xauthority_entry(93, &[7; 16]);
        assert_eq!(&e[..2], [0xff, 0xff]);
        assert_eq!(&e[2..4], [0, 0]);
        assert_eq!(&e[4..8], [0, 2, b'9', b'3']);
        assert_eq!(&e[8..10], [0, 18]);
        assert_eq!(&e[e.len() - 18..e.len() - 16], [0, 16]);
    }
}
