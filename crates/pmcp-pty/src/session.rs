use crate::profile::{Profile, ScreenMatch};
use crate::ring::Ring;
use crate::term::{ExitInfo, Term, TitleCb};
use crate::transcript::Transcript;
use portable_pty::{ChildKiller, CommandBuilder, MasterPty, PtySize, native_pty_system};
use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::num::NonZeroU16;
use std::sync::mpsc::Sender;
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant, SystemTime};

pub struct Session {
    pub id: String,
    pub name: String,
    pub argv: Vec<String>,
    pub profile: Arc<Profile>,
    pub pid: Option<u32>,
    pub labels: BTreeMap<String, String>,
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    term: Mutex<Term>,
    changed: Condvar,
    attachers: Mutex<Option<Vec<Sender<Vec<u8>>>>>,
}

pub struct SpawnSpec {
    pub id: String,
    pub name: String,
    pub argv: Vec<String>,
    pub cwd: Option<String>,
    pub env: Vec<(String, String)>,
    pub unset: Vec<String>,
    pub cols: u16,
    pub rows: u16,
    pub ring_bytes: usize,
    pub profile: Arc<Profile>,
    pub labels: BTreeMap<String, String>,
}

fn nz(v: u16) -> NonZeroU16 {
    NonZeroU16::new(v.max(1)).unwrap_or(NonZeroU16::MIN)
}

fn pty_size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows: rows.max(1),
        cols: cols.max(1),
        pixel_width: 0,
        pixel_height: 0,
    }
}

impl Session {
    pub fn spawn(spec: SpawnSpec) -> Result<Arc<Session>, String> {
        let program = spec.argv.first().ok_or("argv is empty")?;
        let pair = native_pty_system()
            .openpty(pty_size(spec.cols, spec.rows))
            .map_err(|e| format!("openpty: {e}"))?;
        let mut cmd = CommandBuilder::new(program);
        cmd.args(&spec.argv[1..]);
        cmd.env("TERM", "xterm-256color");
        for k in &spec.unset {
            cmd.env_remove(k);
        }
        for (k, v) in &spec.env {
            cmd.env(k, v);
        }
        if let Some(cwd) = &spec.cwd {
            cmd.cwd(cwd);
        }
        let mut child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("spawn {program}: {e}"))?;
        drop(pair.slave);
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("reader: {e}"))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("writer: {e}"))?;
        let parser =
            vt100::Parser::new_with_callbacks(nz(spec.rows), nz(spec.cols), 0, TitleCb::default());
        let session = Arc::new(Session {
            id: spec.id,
            name: spec.name,
            argv: spec.argv,
            profile: spec.profile,
            pid: child.process_id(),
            labels: spec.labels,
            writer: Mutex::new(writer),
            master: Mutex::new(pair.master),
            killer: Mutex::new(child.clone_killer()),
            term: Mutex::new(Term {
                parser,
                ring: Ring::new(spec.ring_bytes),
                transcript: Transcript::new(),
                last_output: Instant::now(),
                last_output_wall: SystemTime::now(),
                exit: None,
                ever_idle: false,
                version: None,
            }),
            changed: Condvar::new(),
            attachers: Mutex::new(Some(Vec::new())),
        });
        let s = session.clone();
        std::thread::spawn(move || s.pump_output(reader));
        let s = session.clone();
        std::thread::spawn(move || {
            let status = child.wait();
            let info = match status {
                Ok(st) => ExitInfo {
                    code: st.exit_code(),
                    signal: st.signal().map(String::from),
                },
                Err(e) => ExitInfo {
                    code: u32::MAX,
                    signal: Some(format!("wait failed: {e}")),
                },
            };
            s.term().exit = Some(info);
            s.changed.notify_all();
        });
        Ok(session)
    }

    fn pump_output(&self, mut reader: Box<dyn Read + Send>) {
        let mut buf = [0u8; 16 * 1024];
        loop {
            let n = match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => n,
            };
            let mut t = self.term();
            t.parser.process(&buf[..n]);
            t.ring.push(&buf[..n]);
            let rows = t.rows();
            let keep = |r: &str| !self.profile.is_chrome(r);
            t.transcript.update(&rows, Instant::now(), &keep);
            t.last_output = Instant::now();
            t.last_output_wall = SystemTime::now();
            let mut attachers = self.attachers.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(list) = attachers.as_mut() {
                list.retain(|tx| tx.send(buf[..n].to_vec()).is_ok());
            }
            drop(attachers);
            drop(t);
            self.changed.notify_all();
        }
        *self.attachers.lock().unwrap_or_else(|e| e.into_inner()) = None;
    }

    pub fn term(&self) -> MutexGuard<'_, Term> {
        self.term.lock().unwrap_or_else(|e| e.into_inner())
    }

    // Settling needs time to pass without output, so readers commit settled rows on demand.
    pub fn settle(&self) -> MutexGuard<'_, Term> {
        let mut t = self.term();
        let settle = Duration::from_millis(self.profile.settle_ms);
        let keep = |r: &str| !self.profile.is_chrome(r);
        t.transcript.settle(Instant::now(), settle, &keep);
        t
    }

    pub fn wait_changed<'a>(
        &self,
        t: MutexGuard<'a, Term>,
        limit: Duration,
    ) -> MutexGuard<'a, Term> {
        self.changed
            .wait_timeout(t, limit)
            .unwrap_or_else(|e| e.into_inner())
            .0
    }

    pub fn observe(&self) -> (ScreenMatch, u64, bool) {
        let t = self.term();
        let m = self
            .profile
            .observe_typed(&t.screen_text(), &t.typed_text());
        (
            m,
            t.last_output.elapsed().as_millis() as u64,
            t.exit.is_none(),
        )
    }

    pub fn write_raw(&self, bytes: &[u8]) -> Result<(), String> {
        let mut w = self.writer.lock().unwrap_or_else(|e| e.into_inner());
        w.write_all(bytes)
            .and_then(|_| w.flush())
            .map_err(|e| format!("write: {e}"))
    }

    /// Waits until the rendered text differs from before; None if it never did within the limit.
    pub fn wait_screen_change(&self, before: &str, limit: Duration) -> Option<u64> {
        let start = Instant::now();
        let mut t = self.term();
        loop {
            if t.screen_text() != before {
                return Some(start.elapsed().as_millis() as u64);
            }
            let left = limit.checked_sub(start.elapsed())?;
            t = self
                .changed
                .wait_timeout(t, left.min(Duration::from_millis(50)))
                .unwrap_or_else(|e| e.into_inner())
                .0;
        }
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        let master = self.master.lock().unwrap_or_else(|e| e.into_inner());
        master
            .resize(pty_size(cols, rows))
            .map_err(|e| format!("resize: {e}"))?;
        self.term().parser.set_size(nz(rows), nz(cols));
        Ok(())
    }

    // A named signal goes to the whole tree once; no name means stop it, escalating to KILL.
    pub fn kill(&self, signal: Option<&str>) -> Result<(), String> {
        #[cfg(unix)]
        if let Some(pid) = self.pid {
            return crate::reap::stop(pid, signal);
        }
        #[cfg(not(unix))]
        let _ = signal;
        let mut killer = self.killer.lock().unwrap_or_else(|e| e.into_inner());
        killer.kill().map_err(|e| format!("kill: {e}"))
    }

    /// Returns a repaint of the current screen taken atomically with joining the output stream.
    pub fn add_attacher(&self, tx: Sender<Vec<u8>>) -> Result<Vec<u8>, String> {
        let t = self.term();
        let repaint = t.parser.screen().contents_formatted().into_bytes();
        let mut attachers = self.attachers.lock().unwrap_or_else(|e| e.into_inner());
        let list = attachers.as_mut().ok_or("session output has closed")?;
        list.push(tx);
        Ok(repaint)
    }
}
