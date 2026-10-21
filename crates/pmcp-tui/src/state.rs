pub use crate::events::{Effect, Event, Failure, Panel, Phase, SessionInfo};
use crate::input;
use crate::keys::{Keys, Outcome};
use crate::layout::plan;
use crate::screen;

// The whole workspace as data: events in, effects out. The terminal, pmcp-pty and the pmcp CLI
// are reached only through effects, so tests drive every transition without either.
pub(crate) struct Attached {
    pub serial: u64,
    pub id: String,
    pub writable: bool,
}

pub struct App {
    pub sessions: Vec<SessionInfo>,
    pub target: Option<String>,
    pub phase: Phase,
    pub panel: Panel,
    pub failure: Option<Failure>,
    pub cols: u16,
    pub rows: u16,
    pub parser: Option<vt100::Parser>,
    pub history: Vec<String>,
    pub history_top: usize,
    pub mailbox: Vec<String>,
    pub mailbox_configured: bool,
    pub(crate) keys: Keys,
    pub(crate) attached: Option<Attached>,
    pub(crate) serial: u64,
    pub(crate) token: Option<String>,
    pub(crate) pending: Option<crate::keys::Action>,
    pub(crate) ticks: u32,
}

impl App {
    pub fn new(cols: u16, rows: u16) -> App {
        App {
            sessions: Vec::new(),
            target: None,
            phase: Phase::ReadOnly,
            panel: Panel::Native,
            failure: None,
            cols,
            rows,
            parser: None,
            history: Vec::new(),
            history_top: 0,
            mailbox: Vec::new(),
            mailbox_configured: false,
            keys: Keys::default(),
            attached: None,
            serial: 0,
            token: None,
            pending: None,
            ticks: 0,
        }
    }

    pub fn main(&self) -> Option<&SessionInfo> {
        self.sessions.iter().find(|s| s.main)
    }

    pub fn workers(&self) -> Vec<&SessionInfo> {
        self.sessions.iter().filter(|s| !s.main).collect()
    }

    pub fn target_info(&self) -> Option<&SessionInfo> {
        let id = self.target.as_ref()?;
        self.sessions.iter().find(|s| &s.id == id)
    }

    /// The main pane's size, which a controlled session is resized to.
    pub fn pane(&self) -> Option<(u16, u16)> {
        plan(self.cols, self.rows)
            .ok()
            .map(|p| (p.main.width, p.main.height))
    }

    /// The session's cursor, shown only while this view holds control of it.
    pub fn cursor(&self) -> Option<ratatui::layout::Position> {
        let main = plan(self.cols, self.rows).ok()?.main;
        let shown = self.phase == Phase::Controlled && self.panel == Panel::Native;
        screen::cursor(self.parser.as_ref()?.screen(), main).filter(|_| shown)
    }

    /// The lease token while control is held or being given back.
    pub fn held_token(&self) -> Option<String> {
        self.token.clone()
    }

    pub fn update(&mut self, event: Event) -> Vec<Effect> {
        match event {
            Event::Key(k) => match self.keys.feed(k) {
                Outcome::Action(a) => self.act(a),
                Outcome::Forward(k) if matches!(self.panel, Panel::History | Panel::Mailbox) => {
                    self.panel_key(k)
                }
                Outcome::Forward(k) => match (&self.attached, &self.parser) {
                    (Some(a), Some(p)) if a.writable && self.phase == Phase::Controlled => {
                        let bytes = input::encode(&k, p.screen().application_cursor());
                        let serial = a.serial;
                        bytes
                            .map(|bytes| Effect::Input { serial, bytes })
                            .into_iter()
                            .collect()
                    }
                    // Not holding control: a key for the session goes nowhere.
                    _ => Vec::new(),
                },
                Outcome::Nothing => Vec::new(),
            },
            Event::Paste(text) => match (&self.attached, &self.parser) {
                (Some(a), Some(p)) if a.writable && self.phase == Phase::Controlled => {
                    let bytes = input::paste(&text, p.screen().bracketed_paste());
                    vec![Effect::Input {
                        serial: a.serial,
                        bytes,
                    }]
                }
                _ => Vec::new(),
            },
            Event::Sessions(list) => {
                self.sessions = list;
                if self.phase != Phase::ReadOnly {
                    return self.renew_tick();
                }
                let keep = self.target_info().is_some_and(|s| s.alive);
                let target = match keep {
                    true => self.target.clone(),
                    false => self.main().map(|m| m.id.clone()),
                };
                self.retarget(target)
            }
            Event::Output { serial, bytes } => {
                if self.attached.as_ref().is_some_and(|a| a.serial == serial)
                    && let Some(p) = self.parser.as_mut()
                {
                    p.process(&bytes);
                }
                Vec::new()
            }
            Event::Closed { serial } => self.closed(serial),
            Event::Resize { cols, rows } => {
                (self.cols, self.rows) = (cols, rows);
                self.resized()
            }
            Event::Failed(f) => {
                self.failure = Some(f);
                Vec::new()
            }
            Event::History { id, text } => self.show_history(id, &text),
            Event::Mailbox(lines) => self.show_mailbox(lines),
            other => self.control_event(other),
        }
    }

    // Shows a session read-only: a fresh attach gives a full repaint, so the parser starts at the
    // session's size and follows it when the session is resized elsewhere.
    pub(crate) fn retarget(&mut self, target: Option<String>) -> Vec<Effect> {
        let mut effects = Vec::new();
        let info = target
            .as_ref()
            .and_then(|id| self.sessions.iter().find(|s| &s.id == id))
            .cloned();
        let same = self.attached.as_ref().map(|a| &a.id) == target.as_ref();
        if same {
            if let (Some(p), Some(s)) = (self.parser.as_mut(), &info) {
                screen::resize(p, s.rows, s.cols);
            }
            return effects;
        }
        if let Some(a) = self.attached.take() {
            effects.push(Effect::Detach { serial: a.serial });
        }
        self.target = target;
        self.parser = None;
        if let Some(s) = info.filter(|s| s.alive) {
            self.serial += 1;
            self.parser = Some(screen::parser(s.rows, s.cols));
            self.attached = Some(Attached {
                serial: self.serial,
                id: s.id.clone(),
                writable: false,
            });
            effects.push(Effect::Attach {
                id: s.id,
                serial: self.serial,
                read_only: true,
                size: None,
                lease: None,
            });
        }
        effects
    }

    // A dropped stream while read-only is attached again on the next list; while controlling,
    // the lease is still held and is given back.
    fn closed(&mut self, serial: u64) -> Vec<Effect> {
        if !self.attached.as_ref().is_some_and(|a| a.serial == serial) {
            return Vec::new();
        }
        self.attached = None;
        match self.phase {
            Phase::Controlled | Phase::Connecting => {
                self.failure = Some(Failure::new("control", "writer_lost", WRITER_LOST));
                self.begin_release(None)
            }
            _ => Vec::new(),
        }
    }

    fn resized(&mut self) -> Vec<Effect> {
        let (Some((cols, rows)), Some(id)) = (self.pane(), self.target.clone()) else {
            return Vec::new();
        };
        if self.phase != Phase::Controlled {
            return Vec::new();
        }
        if let Some(p) = self.parser.as_mut() {
            screen::resize(p, rows, cols);
        }
        vec![Effect::ResizePty { id, cols, rows }]
    }
}

const WRITER_LOST: &str =
    "The writable attach closed; control is being given back. No input is replayed.";
