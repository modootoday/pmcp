use ratatui::buffer::Buffer;
use ratatui::layout::{Position, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::widgets::Widget;

// A session's vt100 screen drawn into a pane. The session keeps its own size: a larger pane
// shows it top-left, a smaller one clips it, so a viewer never reflows someone else's session.
pub struct ScreenView<'a> {
    pub screen: &'a vt100::Screen,
}

fn color(c: vt100::Color) -> Color {
    match c {
        vt100::Color::Default => Color::Reset,
        vt100::Color::Idx(i) => Color::Indexed(i),
        vt100::Color::Rgb(r, g, b) => Color::Rgb(r, g, b),
    }
}

fn style(cell: &vt100::Cell) -> Style {
    let mut s = Style::default()
        .fg(color(cell.fgcolor()))
        .bg(color(cell.bgcolor()));
    for (on, m) in [
        (cell.bold(), Modifier::BOLD),
        (cell.dim(), Modifier::DIM),
        (cell.italic(), Modifier::ITALIC),
        (cell.underline(), Modifier::UNDERLINED),
        (cell.inverse(), Modifier::REVERSED),
    ] {
        if on {
            s = s.add_modifier(m);
        }
    }
    s
}

impl Widget for ScreenView<'_> {
    fn render(self, area: Rect, buf: &mut Buffer) {
        let (rows, cols) = self.screen.size();
        let height = area.height.min(rows.get());
        let width = area.width.min(cols.get());
        for row in 0..height {
            for col in 0..width {
                let Some(cell) = self.screen.cell(row, col) else {
                    continue;
                };
                // The right half of a wide character belongs to the cell before it.
                if cell.is_wide_continuation() {
                    continue;
                }
                // A wide character cut by the pane edge would spill past it; show a blank.
                let symbol = match (cell.has_contents(), cell.is_wide() && col + 1 >= width) {
                    (true, false) => cell.contents(),
                    _ => " ",
                };
                buf[(area.x + col, area.y + row)]
                    .set_symbol(symbol)
                    .set_style(style(cell));
            }
        }
    }
}

/// Where the session's cursor sits in the pane, when it is shown and inside it.
pub fn cursor(screen: &vt100::Screen, area: Rect) -> Option<Position> {
    let (row, col) = screen.cursor_position();
    let inside = row < area.height && col < area.width;
    (!screen.hide_cursor() && inside).then(|| Position::new(area.x + col, area.y + row))
}

fn nonzero(n: u16) -> std::num::NonZeroU16 {
    std::num::NonZeroU16::new(n).unwrap_or(std::num::NonZeroU16::MIN)
}

/// A parser for a session of this size, without scrollback: history is read from pmcp-pty.
pub fn parser(rows: u16, cols: u16) -> vt100::Parser {
    vt100::Parser::new(nonzero(rows), nonzero(cols), 0)
}

pub fn resize(p: &mut vt100::Parser, rows: u16, cols: u16) {
    let (r, c) = p.screen().size();
    if (r.get(), c.get()) != (rows.max(1), cols.max(1)) {
        p.screen_mut().set_size(nonzero(rows), nonzero(cols));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn screen(bytes: &[u8], rows: u16, cols: u16) -> vt100::Parser {
        let mut p = parser(rows, cols);
        p.process(bytes);
        p
    }

    fn row(buf: &Buffer, y: u16) -> String {
        (0..buf.area.width)
            .map(|x| buf[(x, y)].symbol())
            .collect::<String>()
    }

    #[test]
    fn cells_keep_their_attributes_and_wide_korean_takes_two_columns() {
        let p = screen(
            "\x1b[2m› Ask\x1b[0m\r\n\u{C548}\u{B155} ok".as_bytes(),
            4,
            20,
        );
        let mut buf = Buffer::empty(Rect::new(0, 0, 10, 3));
        ScreenView { screen: p.screen() }.render(buf.area, &mut buf);
        assert!(buf[(0, 0)].modifier.contains(Modifier::DIM));
        assert!(!buf[(0, 1)].modifier.contains(Modifier::DIM));
        assert_eq!(buf[(0, 1)].symbol(), "\u{C548}");
        assert_eq!(buf[(2, 1)].symbol(), "\u{B155}");
        assert_eq!(buf[(5, 1)].symbol(), "o");
    }

    #[test]
    fn a_small_pane_clips_and_never_splits_a_wide_character() {
        let p = screen("abcd\u{C548}".as_bytes(), 2, 10);
        let mut buf = Buffer::empty(Rect::new(0, 0, 5, 1));
        ScreenView { screen: p.screen() }.render(buf.area, &mut buf);
        assert_eq!(row(&buf, 0), "abcd ");
        let at = cursor(p.screen(), Rect::new(0, 0, 5, 1));
        assert_eq!(
            at, None,
            "the cursor after the clipped text is outside the pane"
        );
        assert_eq!(
            cursor(p.screen(), Rect::new(3, 2, 20, 5)),
            Some(Position::new(9, 2))
        );
    }
}
