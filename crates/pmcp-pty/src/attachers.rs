use crate::clock::utc_iso;
use crate::session::Session;
use crate::transport::UnixStream;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant, SystemTime};

// Who is attached to which session, so a supervisor can see humans at the keyboard and
// detach them. A sized attach resizes the session; the old size returns with the last one.
struct Attacher {
    serial: u64,
    pid: Option<u32>,
    read_only: bool,
    size: Option<(u16, u16)>,
    since: SystemTime,
    stream: UnixStream,
}

pub struct Joined {
    pub serial: u64,
}

pub struct Registry {
    by_session: Mutex<HashMap<String, Vec<Attacher>>>,
    base: Mutex<HashMap<String, (u16, u16)>>,
    next: AtomicU64,
    // When a person last typed through a writable attach, by session id.
    typed: Mutex<HashMap<String, Instant>>,
}

// A person typing in a session wins over a program for this long after their last keystroke.
pub const HUMAN_QUIET: Duration = Duration::from_secs(5);

fn size_of(s: &Session) -> (u16, u16) {
    let (rows, cols) = s.term().parser.screen().size();
    (cols.get(), rows.get())
}

impl Registry {
    pub fn new() -> Registry {
        Registry {
            by_session: Mutex::new(HashMap::new()),
            base: Mutex::new(HashMap::new()),
            next: AtomicU64::new(1),
            typed: Mutex::new(HashMap::new()),
        }
    }

    pub fn typed(&self, id: &str) {
        let mut typed = self.typed.lock().unwrap_or_else(|e| e.into_inner());
        typed.insert(id.to_string(), Instant::now());
    }

    pub fn human_typing(&self, id: &str) -> bool {
        let typed = self.typed.lock().unwrap_or_else(|e| e.into_inner());
        typed.get(id).is_some_and(|at| at.elapsed() < HUMAN_QUIET)
    }

    pub fn humans(&self, id: &str) -> usize {
        let map = self.by_session.lock().unwrap_or_else(|e| e.into_inner());
        map.get(id)
            .map_or(0, |list| list.iter().filter(|a| !a.read_only).count())
    }

    pub fn join(
        &self,
        s: &Session,
        stream: UnixStream,
        pid: Option<u32>,
        read_only: bool,
        size: Option<(u16, u16)>,
    ) -> Joined {
        if let Some((cols, rows)) = size {
            let mut base = self.base.lock().unwrap_or_else(|e| e.into_inner());
            base.entry(s.id.clone()).or_insert_with(|| size_of(s));
            let _ = s.resize(cols, rows);
        }
        let serial = self.next.fetch_add(1, Ordering::SeqCst);
        let attacher = Attacher {
            serial,
            pid,
            read_only,
            size,
            since: SystemTime::now(),
            stream,
        };
        let mut map = self.by_session.lock().unwrap_or_else(|e| e.into_inner());
        map.entry(s.id.clone()).or_default().push(attacher);
        Joined { serial }
    }

    pub fn leave(&self, s: &Session, serial: u64) {
        let mut map = self.by_session.lock().unwrap_or_else(|e| e.into_inner());
        let list = map.entry(s.id.clone()).or_default();
        list.retain(|a| a.serial != serial);
        if list.iter().any(|a| a.size.is_some()) {
            return;
        }
        let base = self
            .base
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&s.id);
        if let Some((cols, rows)) = base {
            let _ = s.resize(cols, rows);
        }
    }

    pub fn list(&self, id: &str) -> Value {
        let map = self.by_session.lock().unwrap_or_else(|e| e.into_inner());
        let items: Vec<Value> = map
            .get(id)
            .map(|list| {
                list.iter()
                    .map(|a| json!({ "pid": a.pid, "read_only": a.read_only, "size": a.size.map(|(c, r)| json!({ "cols": c, "rows": r })), "since": utc_iso(a.since) }))
                    .collect()
            })
            .unwrap_or_default();
        json!({ "ok": true, "id": id, "attachers": items })
    }

    // Closing the sockets ends each attach loop, which then leaves and restores the size.
    pub fn detach_all(&self, id: &str) -> usize {
        let map = self.by_session.lock().unwrap_or_else(|e| e.into_inner());
        let list = map.get(id).map(Vec::as_slice).unwrap_or_default();
        for a in list {
            let _ = a.stream.shutdown(std::net::Shutdown::Both);
        }
        list.len()
    }
}
