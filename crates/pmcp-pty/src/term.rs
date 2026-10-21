use crate::ring::Ring;
use crate::transcript::Transcript;
use std::time::{Instant, SystemTime};

#[derive(Default)]
pub struct TitleCb {
    pub title: String,
}

impl vt100::Callbacks for TitleCb {
    fn set_window_title(&mut self, _: &mut vt100::Screen, title: &[u8]) {
        self.title = String::from_utf8_lossy(title).into_owned();
    }
}

#[derive(Clone)]
pub struct ExitInfo {
    pub code: u32,
    pub signal: Option<String>,
}

pub struct Term {
    pub parser: vt100::Parser<TitleCb>,
    pub ring: Ring,
    pub transcript: Transcript,
    pub last_output: Instant,
    pub last_output_wall: SystemTime,
    pub exit: Option<ExitInfo>,
    pub ever_idle: bool,
    pub version: Option<String>,
}

// A dim box border or prompt mark is the box itself, not a suggestion: blanking it would hide
// the borders the empty-box patterns anchor on, and an empty box would read as a draft.
fn is_frame(text: &str) -> bool {
    !text.is_empty()
        && text.chars().all(|c| {
            ('\u{2500}'..='\u{257F}').contains(&c) || matches!(c, '❯' | '>' | '›' | '\u{00A0}')
        })
}

impl Term {
    pub fn rows(&self) -> Vec<String> {
        let screen = self.parser.screen();
        let (_, cols) = screen.size();
        screen
            .rows(0, cols.get())
            .map(|r| r.trim_end().to_string())
            .collect()
    }

    pub fn screen_text(&self) -> String {
        self.rows().join("\n")
    }

    // Dim cells are placeholders and suggestions (claude's prompt suggestion after a reply),
    // never typed text, so the input box is read with them blanked out.
    pub fn typed_text(&self) -> String {
        let screen = self.parser.screen();
        let (rows, cols) = screen.size();
        let mut lines = Vec::with_capacity(rows.get() as usize);
        for r in 0..rows.get() {
            let mut line = String::new();
            for c in 0..cols.get() {
                match screen.cell(r, c) {
                    Some(cell) if cell.is_wide_continuation() => {}
                    Some(cell) if cell.dim() && is_frame(cell.contents()) => {
                        line.push_str(cell.contents())
                    }
                    Some(cell) if cell.dim() || !cell.has_contents() => line.push(' '),
                    Some(cell) => line.push_str(cell.contents()),
                    None => line.push(' '),
                }
            }
            lines.push(line.trim_end().to_string());
        }
        lines.join("\n")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_dim_box_keeps_its_border_and_mark_and_loses_only_the_placeholder() {
        let size = |n: u16| std::num::NonZeroU16::new(n).unwrap();
        let mut parser =
            vt100::Parser::new_with_callbacks(size(4), size(30), 0, TitleCb::default());
        let dim = "\x1b[2m──────\x1b[0m\r\n\x1b[2m❯\u{00A0}Try \"fix lint errors\"\x1b[0m\r\n\x1b[2m──────\x1b[0m";
        parser.process(dim.as_bytes());
        let t = Term {
            parser,
            ring: Ring::new(64),
            transcript: Transcript::new(),
            last_output: Instant::now(),
            last_output_wall: SystemTime::now(),
            exit: None,
            ever_idle: false,
            version: None,
        };
        // The row is trimmed like every row, NBSP included, so profiles must not need it.
        assert_eq!(t.typed_text().trim_end(), "──────\n❯\n──────");
    }
}
