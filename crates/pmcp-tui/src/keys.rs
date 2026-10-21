use crossterm::event::{KeyCode, KeyEvent, KeyEventKind, KeyModifiers};

// The tmux workspace's keys: Ctrl-g, release, then one key. Ctrl-g twice sends Ctrl-g on.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    Main,
    // A worker by its dock number, or the next one.
    Observe(Option<usize>),
    WorkerMenu,
    Control,
    Release,
    History,
    Mailbox,
    Management,
    Detach,
    Dismiss,
    Help,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Outcome {
    Action(Action),
    // A key for the session; it reaches the PTY only while this view holds control.
    Forward(KeyEvent),
    // The prefix itself, or a key after it that means nothing.
    Nothing,
}

#[derive(Default)]
pub struct Keys {
    pending: bool,
}

fn is_prefix(k: &KeyEvent) -> bool {
    k.code == KeyCode::Char('g') && k.modifiers.contains(KeyModifiers::CONTROL)
}

impl Keys {
    pub fn feed(&mut self, k: KeyEvent) -> Outcome {
        if k.kind == KeyEventKind::Release {
            return Outcome::Nothing;
        }
        if !self.pending {
            if is_prefix(&k) {
                self.pending = true;
                return Outcome::Nothing;
            }
            return Outcome::Forward(k);
        }
        self.pending = false;
        if is_prefix(&k) {
            return Outcome::Forward(k);
        }
        let KeyCode::Char(c) = k.code else {
            return Outcome::Nothing;
        };
        let action = match c {
            'm' => Action::Main,
            'w' => Action::Observe(None),
            '1'..='9' => Action::Observe(Some(c as usize - '0' as usize)),
            'n' => Action::WorkerMenu,
            'c' => Action::Control,
            'r' => Action::Release,
            'h' => Action::History,
            'b' => Action::Mailbox,
            'g' => Action::Management,
            'd' => Action::Detach,
            '!' => Action::Dismiss,
            '?' => Action::Help,
            _ => return Outcome::Nothing,
        };
        Outcome::Action(action)
    }
}

pub const HELP: &str = "m main; n add worker; w/1-9 worker; c control; r release; h history; \
b mailbox; g management; d detach; ! dismiss error; double Ctrl-g forwards native Ctrl-g";

#[cfg(test)]
mod tests {
    use super::*;

    fn key(c: char, m: KeyModifiers) -> KeyEvent {
        KeyEvent::new(KeyCode::Char(c), m)
    }

    #[test]
    fn the_prefix_picks_one_action_and_twice_forwards_itself() {
        let mut k = Keys::default();
        let plain = key('x', KeyModifiers::NONE);
        assert_eq!(k.feed(plain), Outcome::Forward(plain));
        let prefix = key('g', KeyModifiers::CONTROL);
        assert_eq!(k.feed(prefix), Outcome::Nothing);
        assert_eq!(
            k.feed(key('2', KeyModifiers::NONE)),
            Outcome::Action(Action::Observe(Some(2)))
        );
        // The prefix lasts for one key only.
        assert_eq!(
            k.feed(key('c', KeyModifiers::NONE)),
            Outcome::Forward(key('c', KeyModifiers::NONE))
        );
        k.feed(prefix);
        assert_eq!(k.feed(prefix), Outcome::Forward(prefix));
        k.feed(prefix);
        assert_eq!(k.feed(key('z', KeyModifiers::NONE)), Outcome::Nothing);
        k.feed(prefix);
        assert_eq!(
            k.feed(key('d', KeyModifiers::NONE)),
            Outcome::Action(Action::Detach)
        );
    }
}
