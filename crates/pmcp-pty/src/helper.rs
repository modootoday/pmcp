use crate::error::{Code, Fail};
use crate::session::Session;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

// A delivery channel's helper (codex's private app-server, the session's grok leader) runs as the
// daemon's own child beside the TUI, with no shell wrapper, so it works wherever there is no sh.
// Its output goes to helper.log: live, app-server errors painted over the TUI read as a draft.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HelperSpec {
    pub argv: Vec<String>,
    pub socket: PathBuf,
    pub log: PathBuf,
}

#[derive(Debug)]
pub struct Helper {
    #[cfg_attr(not(unix), allow(dead_code))]
    pub pid: u32,
    child: Mutex<Child>,
}

const READY: Duration = Duration::from_secs(10);

/// Starts the helper and waits until its socket exists, as the TUI connects to it at start.
pub fn start(
    spec: &HelperSpec,
    env: &[(String, String)],
    unset: &[String],
    cwd: Option<&str>,
) -> Result<Arc<Helper>, Fail> {
    let fail = |m: String| Fail::new(Code::BadRequest, m);
    let (program, args) = spec
        .argv
        .split_first()
        .ok_or_else(|| fail("helper argv is empty".into()))?;
    let log = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&spec.log)
        .map_err(|e| fail(format!("open {}: {e}", spec.log.display())))?;
    let err = log.try_clone().map_err(|e| fail(e.to_string()))?;
    let mut cmd = Command::new(program);
    cmd.args(args).stdin(Stdio::null()).stdout(log).stderr(err);
    for k in unset {
        cmd.env_remove(k);
    }
    cmd.envs(env.iter().map(|(k, v)| (k, v)));
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    // Its own process group, so stopping it signals exactly the helper and what it started.
    #[cfg(unix)]
    std::os::unix::process::CommandExt::process_group(&mut cmd, 0);
    let mut child = cmd
        .spawn()
        .map_err(|e| fail(format!("start {program}: {e}")))?;
    let pid = child.id();
    let started = Instant::now();
    while !spec.socket.exists() && started.elapsed() < READY {
        if let Ok(Some(status)) = child.try_wait() {
            let why = format!(
                "{program} exited ({status}) before its socket appeared; see {}",
                spec.log.display()
            );
            return Err(fail(why));
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    Ok(Arc::new(Helper {
        pid,
        child: Mutex::new(child),
    }))
}

impl Helper {
    /// HUP, then KILL after the grace period: the grok leader seen live ignored SIGTERM.
    pub fn stop(&self) {
        #[cfg(unix)]
        crate::reap::terminate(&[self.pid], crate::reap::GRACE);
        let mut child = self.child.lock().unwrap_or_else(|e| e.into_inner());
        #[cfg(not(unix))]
        let _ = child.kill();
        let _ = child.wait();
    }
}

/// Stops the helper once its TUI has exited.
pub fn watch(helper: Arc<Helper>, session: Arc<Session>) {
    std::thread::spawn(move || {
        while session.term().exit.is_none() {
            std::thread::sleep(Duration::from_millis(100));
        }
        helper.stop();
    });
}

pub fn log_path(dir: &Path) -> PathBuf {
    dir.join("helper.log")
}
