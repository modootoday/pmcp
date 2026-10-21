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
fn is_border(text: &str) -> bool {
    !text.is_empty()
        && text
            .chars()
            .all(|c| ('\u{2500}'..='\u{257F}').contains(&c) || c == '\u{00A0}')
}

// A mark glyph is the prompt only where a prompt sits, before any text on the row: the closing
// > of a dim placeholder such as Try "how does <filepath> work?" is the suggestion, not the box.
fn is_mark(text: &str, before: &str) -> bool {
    matches!(text, "❯" | ">" | "›")
        && before
            .chars()
            .all(|c| c.is_whitespace() || is_border(&c.to_string()))
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
                    Some(cell)
                        if cell.dim()
                            && (is_border(cell.contents()) || is_mark(cell.contents(), &line)) =>
                    {
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

    // Claude 2.1.305 drew the tip Try "how does <filepath> work?" dim, cell by cell; its closing
    // > was kept as a prompt mark, the box read as neither empty nor a draft, and a fresh
    // session stayed "starting" (live check, 2026-10-21).
    #[test]
    fn a_dim_mark_glyph_inside_the_placeholder_is_not_the_prompt() {
        let size = |n: u16| std::num::NonZeroU16::new(n).unwrap();
        let mut parser =
            vt100::Parser::new_with_callbacks(size(3), size(40), 0, TitleCb::default());
        let row = "\x1b[38;5;244m──────\x1b[39m\r\n❯\u{00A0}\x1b[2mTry\x1b[7G\"how\x1b[12Gdoes\x1b[17G<filepath>\x1b[28Gwork?\"\x1b[22m\r\n\x1b[38;5;244m──────\x1b[39m";
        parser.process(row.as_bytes());
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
        assert_eq!(t.typed_text().trim_end(), "──────\n❯\n──────");
        let set = crate::profile::ProfileSet::parse(crate::profile::BUILTIN).unwrap();
        let claude = set.get("claude").unwrap();
        let m = claude.observe_typed(&t.screen_text(), &t.typed_text());
        assert_eq!(m.input_empty, Some(true));
        assert!(!claude.composer_missing(&m));
    }
}
