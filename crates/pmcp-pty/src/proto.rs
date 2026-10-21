// The wire protocol: one JSON request per line. Types serialize both ways so another crate
// (a TUI, a test harness) can build requests with the same definitions the daemon parses.
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub use crate::clock::utc_iso;

#[derive(Serialize, Deserialize, Debug)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Request {
    Spawn(SpawnReq),
    List {
        #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
        labels: BTreeMap<String, String>,
    },
    Screen {
        id: String,
    },
    Tail {
        id: String,
        #[serde(default)]
        bytes: Option<usize>,
        #[serde(default)]
        strip: bool,
    },
    State {
        id: String,
    },
    Observe {
        id: String,
        #[serde(default)]
        lines: Option<usize>,
    },
    Wait(WaitReq),
    Read {
        id: String,
        #[serde(default)]
        since: Option<u64>,
        #[serde(default)]
        max_chars: Option<usize>,
    },
    Turn(TurnReq),
    Write(WriteReq),
    Key {
        id: String,
        key: String,
        #[serde(default)]
        expect: Option<Expect>,
    },
    Resize {
        id: String,
        cols: u16,
        rows: u16,
        #[serde(default)]
        expect: Option<Expect>,
    },
    Kill {
        id: String,
        #[serde(default)]
        signal: Option<String>,
        #[serde(default)]
        expect: Option<Expect>,
    },
    Remove {
        id: String,
    },
    Subscribe {
        id: String,
    },
    Attach(AttachReq),
    Attachers {
        id: String,
    },
    /// From pmcp's hooks inside a hosted runtime: session_start, turn_start, turn_end (message
    /// is the last assistant message) or permission.
    Event {
        id: String,
        kind: String,
        #[serde(default)]
        message: Option<String>,
        /// The runtime's own session id; a structured channel then targets the conversation
        /// the TUI shows instead of guessing one.
        #[serde(default)]
        session: Option<String>,
        #[serde(default)]
        expect: Option<Expect>,
    },
    Record {
        id: String,
        label: String,
        #[serde(default = "redact_by_default")]
        redact: bool,
    },
    Detach {
        id: String,
    },
    Lease(LeaseReq),
    Answer(AnswerReq),
    Describe,
    Shutdown,
}

#[path = "proto_control.rs"]
mod control;
pub use control::{AnswerReq, AttachReq, LeaseReq, parse_line};

#[derive(Serialize, Deserialize, Debug, Default)]
pub struct SpawnReq {
    #[serde(default)]
    pub name: Option<String>,
    pub argv: Vec<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    #[serde(default)]
    pub cols: Option<u16>,
    #[serde(default)]
    pub rows: Option<u16>,
    #[serde(default)]
    pub profile: Option<String>,
    #[serde(default)]
    pub ring_kb: Option<usize>,
    #[serde(default)]
    pub labels: BTreeMap<String, String>,
    /// Launch the runtime so its profile's delivery channel works (a private Codex app-server,
    /// a pinned opencode port, a private grok leader socket). Off: turn uses the screen.
    #[serde(default)]
    pub delivery_setup: bool,
    /// Inherited runtime session markers to keep; every other one is removed (see scrub.rs).
    #[serde(default)]
    pub keep_env: Vec<String>,
}

/// The session a mutating request means: the daemon instance and child pid from spawn. A
/// mismatch fails with code stale instead of reaching a different session. While a harness
/// lease is live, lease must carry its token, else the request fails with code lease.
#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
pub struct Expect {
    #[serde(default)]
    pub instance: Option<String>,
    #[serde(default)]
    pub pid: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lease: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Debug, Default)]
#[serde(rename_all = "snake_case")]
pub enum Guard {
    #[default]
    Idle,
    None,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct WriteReq {
    pub id: String,
    pub text: String,
    #[serde(default)]
    pub submit: bool,
    #[serde(default)]
    pub guard: Guard,
    #[serde(default)]
    pub wait_ms: Option<u64>,
    #[serde(default)]
    pub expect: Option<Expect>,
}

/// One wait condition: a name (idle, turn_end, dialog, exit, output) or a text regex.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(untagged)]
pub enum Until {
    Named(String),
    Text { text: String },
}

#[derive(Serialize, Deserialize, Debug)]
pub struct WaitReq {
    pub id: String,
    pub until: Vec<Until>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct TurnReq {
    pub id: String,
    pub text: String,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    #[serde(default)]
    pub expect: Option<Expect>,
    #[serde(default)]
    pub target: Option<Target>,
    /// Wait up to this long for the session to be idle before delivering; a dialog still refuses.
    #[serde(default)]
    pub wait_idle_ms: Option<u64>,
}

/// What a structured channel needs that only the caller knows: the runtime's own session or
/// thread id (from pmcp's registry), and optionally an app-server address or server URL.
#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
pub struct Target {
    #[serde(default)]
    pub session: Option<String>,
    #[serde(default)]
    pub remote: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
}

// A recording leaves the host only after review, so paths, accounts and ids are masked unless
// the caller opts out.
fn redact_by_default() -> bool {
    true
}

#[cfg(test)]
#[path = "proto_tests.rs"]
mod tests;
