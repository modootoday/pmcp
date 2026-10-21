use crate::events::{Effect, Failure, Panel, Phase};
use crate::keys::Action;
use crate::state::App;

// Leaving the controlled session (another target, a panel, detach) gives control back first, as
// the tmux workspace did; the action then runs once the release is confirmed.
impl App {
    pub(crate) fn act(&mut self, action: Action) -> Vec<Effect> {
        if self.panel == Panel::Help {
            self.panel = Panel::Native;
        }
        match action {
            Action::Help => {
                self.panel = Panel::Help;
                Vec::new()
            }
            Action::Dismiss => {
                self.failure = None;
                Vec::new()
            }
            Action::Management => {
                self.panel = match self.panel {
                    Panel::Management => Panel::Native,
                    _ => Panel::Management,
                };
                Vec::new()
            }
            Action::Control => self.acquire(),
            Action::Release => self.begin_release(None),
            Action::WorkerMenu => self.fail("worker-menu", "unsupported_view_operation", NO_GROUPS),
            leaving => match self.phase {
                Phase::Controlled | Phase::Connecting => self.begin_release(Some(leaving)),
                Phase::Acquiring | Phase::Releasing => self.fail(
                    "key",
                    "control_in_progress",
                    "Wait for the control change to finish.",
                ),
                Phase::Uncertain if leaving != Action::Detach => {
                    self.fail("key", "control_unknown", UNKNOWN)
                }
                _ => self.run(leaving),
            },
        }
    }

    pub(crate) fn run(&mut self, action: Action) -> Vec<Effect> {
        match action {
            Action::Main => {
                self.panel = Panel::Native;
                let main = self.main().map(|m| m.id.clone());
                self.retarget(main)
            }
            Action::Observe(index) => {
                self.panel = Panel::Native;
                let workers = self.workers();
                let current = workers
                    .iter()
                    .position(|w| Some(&w.id) == self.target.as_ref());
                let next = current.map_or(0, |i| (i + 1) % workers.len().max(1));
                let pick = match index {
                    Some(n) => workers.get(n.wrapping_sub(1)),
                    None => workers.get(next),
                };
                match pick.map(|w| w.id.clone()) {
                    Some(id) => self.retarget(Some(id)),
                    None => self.fail("observe", "worker_unavailable", "No worker at that number."),
                }
            }
            Action::History => match self.target.clone() {
                Some(id) => vec![Effect::ReadHistory { id }],
                None => self.fail("history", "target_unavailable", "No session is shown."),
            },
            Action::Mailbox => match self.mailbox_configured {
                true => vec![Effect::ReadMailbox],
                false => self.fail("mailbox", "mailbox_not_configured", NO_MAILBOX),
            },
            Action::Detach => vec![Effect::Quit],
            _ => Vec::new(),
        }
    }

    pub(crate) fn fail(&mut self, action: &str, code: &str, hint: &str) -> Vec<Effect> {
        self.failure = Some(Failure::new(action, code, hint));
        Vec::new()
    }
}

const NO_GROUPS: &str =
    "Start a worker with pmcp tui start-worker --runtime <id>; it appears in the dock.";
const NO_MAILBOX: &str =
    "Start pmcp-tui with --mailbox-config and --actor-file to observe inbox metadata.";
const UNKNOWN: &str =
    "Control state is unknown. Ctrl-g r retries the release; inspect before typing.";
