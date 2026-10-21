use crate::events::{Effect, Event, Failure, Panel, Phase};
use crate::screen;
use crate::state::{App, Attached};

// Control is the lease first, then a writable attach that carries its token; CONTROL READY only
// once pmcp-pty accepted that attach. The lease is renewed while held and always given back.
// Renew about every nine seconds (six list refreshes) against a 30 s lease.
const RENEW_EVERY: u32 = 6;

impl App {
    pub(crate) fn acquire(&mut self) -> Vec<Effect> {
        match self.phase {
            Phase::Controlled => return Vec::new(),
            Phase::ReadOnly => {}
            Phase::Uncertain => return self.fail("control", "control_unknown", RETRY),
            _ => {
                return self.fail(
                    "control",
                    "control_in_progress",
                    "Wait for the control change to finish.",
                );
            }
        }
        let Some(id) = self.target_info().filter(|s| s.alive).map(|s| s.id.clone()) else {
            return self.fail(
                "control",
                "target_unavailable",
                "No running session is shown.",
            );
        };
        self.panel = Panel::Native;
        self.phase = Phase::Acquiring;
        vec![Effect::Acquire { id }]
    }

    pub(crate) fn begin_release(&mut self, after: Option<crate::keys::Action>) -> Vec<Effect> {
        let (Some(token), Some(id)) = (self.token.clone(), self.target.clone()) else {
            if self.phase == Phase::Acquiring {
                return self.fail(
                    "release",
                    "control_in_progress",
                    "Control is still being requested.",
                );
            }
            self.phase = Phase::ReadOnly;
            return after.map(|a| self.run(a)).unwrap_or_default();
        };
        self.phase = Phase::Releasing;
        self.pending = after;
        let mut effects = Vec::new();
        if let Some(a) = self.attached.take_if(|a| a.writable) {
            effects.push(Effect::Detach { serial: a.serial });
        }
        effects.push(Effect::Release { id, token });
        effects
    }

    pub(crate) fn renew_tick(&mut self) -> Vec<Effect> {
        self.ticks = self.ticks.wrapping_add(1);
        match (&self.token, &self.target, self.phase) {
            (Some(token), Some(id), Phase::Controlled)
                if self.ticks.is_multiple_of(RENEW_EVERY) =>
            {
                vec![Effect::Renew {
                    id: id.clone(),
                    token: token.clone(),
                }]
            }
            _ => Vec::new(),
        }
    }

    pub(crate) fn control_event(&mut self, event: Event) -> Vec<Effect> {
        match event {
            Event::Leased { token } => self.leased(token),
            Event::Writable { serial } => {
                let ours = self
                    .attached
                    .as_ref()
                    .is_some_and(|a| a.serial == serial && a.writable);
                if ours && self.phase == Phase::Connecting {
                    self.phase = Phase::Controlled;
                    self.ticks = 0;
                }
                Vec::new()
            }
            Event::ControlFailed(f) => {
                self.failure = Some(f);
                if self.token.is_some() {
                    return self.begin_release(None);
                }
                self.phase = Phase::ReadOnly;
                let target = self.target.clone();
                self.attached = None;
                self.retarget(target)
            }
            Event::Released => {
                self.token = None;
                self.phase = Phase::ReadOnly;
                self.attached = None;
                let target = self.target.clone();
                let mut effects = self.retarget(target);
                if let Some(a) = self.pending.take() {
                    effects.extend(self.run(a));
                }
                effects
            }
            Event::ReleaseFailed(f) => {
                self.failure = Some(f);
                self.phase = Phase::Uncertain;
                self.pending = None;
                Vec::new()
            }
            _ => Vec::new(),
        }
    }

    // The read-only view gives way to a writable attach sized to the pane.
    fn leased(&mut self, token: String) -> Vec<Effect> {
        let Some(id) = self
            .target
            .clone()
            .filter(|_| self.phase == Phase::Acquiring)
        else {
            let id = self.target.clone().unwrap_or_default();
            return vec![Effect::Release { id, token }];
        };
        self.token = Some(token.clone());
        self.phase = Phase::Connecting;
        let mut effects = Vec::new();
        if let Some(a) = self.attached.take() {
            effects.push(Effect::Detach { serial: a.serial });
        }
        let size = self.pane();
        let (cols, rows) = size.unwrap_or((80, 24));
        self.serial += 1;
        self.parser = Some(screen::parser(rows, cols));
        self.attached = Some(Attached {
            serial: self.serial,
            id: id.clone(),
            writable: true,
        });
        effects.push(Effect::Attach {
            id,
            serial: self.serial,
            read_only: false,
            size,
            lease: Some(token),
        });
        effects
    }
}

// Mid-turn is the profile's busy indicator (a spinner, "esc to cancel"), not merely recent output:
// a person's own typing a moment ago must not keep them from taking control again.
pub(crate) fn busy(indicator: Option<&str>) -> Option<Failure> {
    indicator.map(|_| Failure::new("control", "target_busy", BUSY))
}

const RETRY: &str =
    "Control state is unknown. Ctrl-g r retries the release; inspect before typing.";
const BUSY: &str =
    "The session is mid-turn. Control is not taken during a turn; try again when it is idle.";
