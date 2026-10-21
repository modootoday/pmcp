use super::{Profile, ScreenMatch, first_match};

// The input box is read from the typed text, the screen with dim cells blanked: placeholders
// and suggestions (claude shows one after each reply) are dim and never something typed.
impl Profile {
    // The draft from the input pattern's named group text; None when unknown. The last matching
    // row wins; a pattern spanning rows (agy's box between two rules) is tried on the whole
    // text when no single row matches.
    pub fn input_text(&self, typed: &str) -> Option<String> {
        let pattern = self.input.as_ref()?;
        typed
            .lines()
            .rev()
            .find_map(|line| pattern.regex.captures(line))
            .or_else(|| pattern.regex.captures_iter(typed).last())
            .map(|c| {
                c.name("text")
                    .map(|m| m.as_str().trim_end().to_string())
                    .unwrap_or_default()
            })
    }

    // The empty-box pattern wins over the input pattern. Under a dialog the box is not what is
    // shown (codex draws its selection marker with the composer's glyph), so there is no draft.
    pub fn draft(&self, screen_text: &str, typed: &str) -> Option<String> {
        if first_match(&self.dialogs, screen_text).is_some() {
            return None;
        }
        match first_match(&self.input_empty, typed) {
            Some(_) => Some(String::new()),
            None => self.input_text(typed),
        }
    }

    // A screen with no input box at all (codex's banner while its MCP servers start, a dialog)
    // is not a box holding a draft: input_empty is unknown there, not false. Live, a codex
    // turn sent right after startup was refused as "input box is not empty".
    pub fn observe_typed(&self, screen_text: &str, typed: &str) -> ScreenMatch {
        let mut m = self.observe(screen_text);
        if !self.input_empty.is_empty() {
            let empty = first_match(&self.input_empty, typed).is_some();
            let shown = empty || self.input.is_none() || self.input_text(typed).is_some();
            m.input_empty = shown.then_some(empty);
        }
        m
    }

    /// The profile reads an input box, none is on screen, and no dialog explains why: the TUI
    /// is not ready for input yet.
    pub fn composer_missing(&self, m: &ScreenMatch) -> bool {
        self.input.is_some()
            && !self.input_empty.is_empty()
            && m.input_empty.is_none()
            && m.dialog.is_none()
    }
}
