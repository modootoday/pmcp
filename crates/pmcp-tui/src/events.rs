use crossterm::event::KeyEvent;

// What flows into the state machine and what it asks for in return.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SessionInfo {
    pub id: String,
    pub name: String,
    pub runtime: String,
    pub status: String,
    pub alive: bool,
    pub cols: u16,
    pub rows: u16,
    pub main: bool,
}

// The tmux workspace's control phases; only Controlled lets keys reach the session.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    ReadOnly,
    Acquiring,
    Connecting,
    Controlled,
    Releasing,
    Uncertain,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Panel {
    Native,
    Management,
    Help,
    History,
    Mailbox,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Failure {
    pub action: String,
    pub code: String,
    pub hint: String,
}

impl Failure {
    pub fn new(action: &str, code: &str, hint: impl Into<String>) -> Failure {
        Failure {
            action: action.into(),
            code: code.into(),
            hint: hint.into(),
        }
    }
}

pub enum Event {
    Key(KeyEvent),
    Paste(String),
    Sessions(Vec<SessionInfo>),
    Output { serial: u64, bytes: Vec<u8> },
    Closed { serial: u64 },
    Resize { cols: u16, rows: u16 },
    Failed(Failure),
    // Control: the lease is held, the writable attach is up, the lease is given back.
    Leased { token: String },
    Writable { serial: u64 },
    Released,
    // Acquire, attach or renew went wrong; Released afterwards when nothing is left held.
    ControlFailed(Failure),
    ReleaseFailed(Failure),
    History { id: String, text: String },
    Mailbox(Option<Vec<String>>),
}

#[derive(Debug, PartialEq, Eq)]
pub enum Effect {
    Attach {
        id: String,
        serial: u64,
        read_only: bool,
        // Sized to the pane and carrying the lease token for a writable attach only.
        size: Option<(u16, u16)>,
        lease: Option<String>,
    },
    Detach {
        serial: u64,
    },
    Acquire {
        id: String,
    },
    Renew {
        id: String,
        token: String,
    },
    Release {
        id: String,
        token: String,
    },
    Input {
        serial: u64,
        bytes: Vec<u8>,
    },
    ResizePty {
        id: String,
        cols: u16,
        rows: u16,
    },
    ReadHistory {
        id: String,
    },
    ReadMailbox,
    Quit,
}
