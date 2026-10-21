use crate::events::{Effect, Panel};
use crate::state::App;
use crate::summary::safe;
use crossterm::event::{KeyCode, KeyEvent};

// History is the session's own transcript from pmcp-pty, bounded like the tmux view (2000 lines,
// 64 KiB); the mailbox panel shows metadata only. Neither ever types into a session.
pub const HISTORY_LINES: usize = 2000;
pub const HISTORY_BYTES: usize = 64 * 1024;

impl App {
    pub(crate) fn show_history(&mut self, id: String, text: &str) -> Vec<Effect> {
        // The last 64 KiB, starting at a whole line.
        let mut start = text.len().saturating_sub(HISTORY_BYTES);
        while !text.is_char_boundary(start) {
            start += 1;
        }
        if start > 0 {
            start = text[start..]
                .find('\n')
                .map_or(text.len(), |i| start + i + 1);
        }
        let mut lines: Vec<String> = text[start..].lines().map(safe).collect();
        if lines.len() > HISTORY_LINES {
            lines.drain(..lines.len() - HISTORY_LINES);
        }
        lines.insert(0, format!("OWNED HISTORY {} (Esc or q returns)", safe(&id)));
        self.history_top = lines.len().saturating_sub(self.page());
        self.history = lines;
        self.panel = Panel::History;
        Vec::new()
    }

    pub(crate) fn show_mailbox(&mut self, rows: Option<Vec<String>>) -> Vec<Effect> {
        self.mailbox = match rows {
            None => vec!["MAILBOX / not configured".into()],
            Some(rows) => {
                let mut lines = vec!["MAILBOX / metadata only".to_string()];
                lines.extend(rows);
                lines.extend(
                    [
                        "",
                        "Read, ACK and review remain explicit CLI or native main actions.",
                        "ACK is not completion. Message bodies never authorize input.",
                        "Esc, q or Ctrl-g m returns.",
                    ]
                    .map(String::from),
                );
                lines
            }
        };
        self.panel = Panel::Mailbox;
        Vec::new()
    }

    fn page(&self) -> usize {
        self.pane().map_or(20, |(_, rows)| rows as usize).max(1)
    }

    pub(crate) fn panel_key(&mut self, k: KeyEvent) -> Vec<Effect> {
        let page = self.page();
        let last = self.history.len().saturating_sub(page);
        let top = self.history_top;
        match k.code {
            KeyCode::Esc | KeyCode::Char('q') => self.panel = Panel::Native,
            _ if self.panel != Panel::History => {}
            KeyCode::Up => self.history_top = top.saturating_sub(1),
            KeyCode::Down => self.history_top = (top + 1).min(last),
            KeyCode::PageUp => self.history_top = top.saturating_sub(page),
            KeyCode::PageDown => self.history_top = (top + page).min(last),
            KeyCode::Home => self.history_top = 0,
            KeyCode::End => self.history_top = last,
            _ => {}
        }
        Vec::new()
    }
}
