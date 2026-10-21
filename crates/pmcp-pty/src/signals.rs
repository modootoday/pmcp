use std::sync::{Arc, Mutex};

// What the runtime itself says about its turns, ranked above the screen: pmcp's hooks inside a
// hosted runtime report turn start and end with the last assistant message, and a structured
// channel (ACP) reports its own end. A TUI need not draw a turn started elsewhere (grok's
// welcome screen did not), but its hooks still fire.
#[derive(Default, Debug)]
pub struct Signals {
    pub seq: u64,
    pub hooks_live: bool,
    pub hook_end: Option<(u64, String)>,
    pub channel_end: Option<(u64, String, Option<String>)>,
    pub permission: Option<(u64, String)>,
    // The runtime's own session id as its hooks report it: the conversation the TUI shows.
    pub runtime_session: Option<String>,
}

pub type Shared = Arc<Mutex<Signals>>;

pub const KINDS: [&str; 4] = ["session_start", "turn_start", "turn_end", "permission"];

impl Signals {
    fn next(&mut self) -> u64 {
        self.seq += 1;
        self.seq
    }

    pub fn hook(&mut self, kind: &str, message: Option<String>, session: Option<String>) -> u64 {
        self.hooks_live = true;
        if session.is_some() {
            self.runtime_session = session;
        }
        let seq = self.next();
        match kind {
            "turn_end" => self.hook_end = Some((seq, message.unwrap_or_default())),
            "permission" => self.permission = Some((seq, message.unwrap_or_default())),
            _ => {}
        }
        seq
    }

    pub fn channel_end(&mut self, reply: String, stop_reason: Option<String>) {
        let seq = self.next();
        self.channel_end = Some((seq, reply, stop_reason));
    }
}

/// How a turn that started after base ended, if it has: (signal, reply, stop reason).
pub fn ended(s: &Signals, base: u64) -> Option<(&'static str, String, Option<String>)> {
    if let Some((seq, msg)) = &s.hook_end
        && *seq > base
    {
        return Some(("hook", msg.clone(), None));
    }
    match &s.channel_end {
        Some((seq, reply, stop)) if *seq > base => Some(("channel", reply.clone(), stop.clone())),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_hook_end_outranks_a_channel_end_and_only_counts_after_the_turn_began() {
        let mut s = Signals::default();
        s.hook("turn_end", Some("old".into()), Some("rt-1".into()));
        let base = s.seq;
        assert_eq!(s.runtime_session.as_deref(), Some("rt-1"));
        assert_eq!(ended(&s, base), None);
        s.channel_end("from acp".into(), Some("end_turn".into()));
        assert_eq!(
            ended(&s, base),
            Some(("channel", "from acp".into(), Some("end_turn".into())))
        );
        s.hook("turn_end", Some("PTY-OK".into()), None);
        assert_eq!(ended(&s, base), Some(("hook", "PTY-OK".into(), None)));
        assert!(s.hooks_live);
        assert_eq!(s.runtime_session.as_deref(), Some("rt-1"));
    }
}
