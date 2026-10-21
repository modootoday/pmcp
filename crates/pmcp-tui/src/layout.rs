use ratatui::layout::Rect;

// The same plan as the tmux workspace (src/harness/terminal/layout.ts), so a person moving from
// one to the other finds main, the worker dock and coordination where they were.
pub const MIN_COLS: u16 = 40;
pub const MIN_ROWS: u16 = 12;
const SPLIT_COLS: u16 = 120;
const SPLIT_ROWS: u16 = 32;
const COORDINATION_ROWS: u16 = 4;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    // Main left, dock right, coordination below.
    Split,
    // Full-width main; dock and coordination live on the management screen.
    Compact,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Plan {
    pub mode: Mode,
    pub main: Rect,
    pub dock: Option<Rect>,
    pub coordination: Option<Rect>,
    pub status: Rect,
}

pub fn plan(cols: u16, rows: u16) -> Result<Plan, String> {
    if cols < MIN_COLS || rows < MIN_ROWS {
        return Err(format!(
            "terminal is {cols}x{rows}; the workspace needs at least {MIN_COLS}x{MIN_ROWS}"
        ));
    }
    let content = rows - 1;
    let status = Rect::new(0, content, cols, 1);
    if cols < SPLIT_COLS || rows < SPLIT_ROWS {
        return Ok(Plan {
            mode: Mode::Compact,
            main: Rect::new(0, 0, cols, content),
            dock: None,
            coordination: None,
            status,
        });
    }
    let dock_cols = (cols / 4).clamp(28, 40);
    let main_cols = cols - dock_cols - 1;
    let native_rows = content - COORDINATION_ROWS - 1;
    Ok(Plan {
        mode: Mode::Split,
        main: Rect::new(0, 0, main_cols, native_rows),
        dock: Some(Rect::new(main_cols + 1, 0, dock_cols, native_rows)),
        coordination: Some(Rect::new(0, native_rows + 1, cols, COORDINATION_ROWS)),
        status,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_and_compact_match_the_tmux_plan() {
        let p = plan(160, 48).unwrap();
        assert_eq!(p.mode, Mode::Split);
        assert_eq!(p.main, Rect::new(0, 0, 119, 42));
        assert_eq!(p.dock, Some(Rect::new(120, 0, 40, 42)));
        assert_eq!(p.coordination, Some(Rect::new(0, 43, 160, 4)));
        assert_eq!(p.status, Rect::new(0, 47, 160, 1));
        // A quarter of 120 is 30, inside the 28..40 band.
        assert_eq!(plan(120, 32).unwrap().dock, Some(Rect::new(90, 0, 30, 26)));
        let c = plan(100, 30).unwrap();
        assert_eq!((c.mode, c.main), (Mode::Compact, Rect::new(0, 0, 100, 29)));
        assert!(plan(119, 48).unwrap().dock.is_none());
        assert!(plan(39, 12).is_err() && plan(40, 11).is_err() && plan(40, 12).is_ok());
    }
}
