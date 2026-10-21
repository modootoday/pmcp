use super::*;

const SETTLE: Duration = Duration::from_millis(100);

fn rows(lines: &[&str]) -> Vec<String> {
    lines.iter().map(|s| s.to_string()).collect()
}

fn keep_all(_: &str) -> bool {
    true
}

fn all(t: &Transcript) -> Vec<String> {
    t.lines_since(0)
}

#[test]
fn a_settled_row_is_committed_once() {
    let mut t = Transcript::new();
    let t0 = Instant::now();
    t.update(&rows(&["hello", ""]), t0, &keep_all);
    t.settle(t0 + Duration::from_millis(50), SETTLE, &keep_all);
    assert!(all(&t).is_empty());
    t.settle(t0 + SETTLE, SETTLE, &keep_all);
    t.settle(t0 + SETTLE * 3, SETTLE, &keep_all);
    assert_eq!(all(&t), vec!["hello"]);
}

#[test]
fn rows_that_scroll_off_are_committed_at_once_in_order() {
    let mut t = Transcript::new();
    let t0 = Instant::now();
    t.update(&rows(&["one", "two", "three"]), t0, &keep_all);
    t.update(&rows(&["three", "four", "five"]), t0, &keep_all);
    assert_eq!(all(&t), vec!["one", "two"]);
    t.settle(t0 + SETTLE, SETTLE, &keep_all);
    assert_eq!(all(&t), vec!["one", "two", "three", "four", "five"]);
}

#[test]
fn a_committed_row_that_moves_or_scrolls_away_is_not_committed_again() {
    let mut t = Transcript::new();
    let t0 = Instant::now();
    t.update(&rows(&["a", "b", "", "> "]), t0, &keep_all);
    t.settle(t0 + SETTLE, SETTLE, &keep_all);
    // A redraw inserts a line above, so a and b move down without a scroll.
    t.update(&rows(&["new", "a", "b", "> "]), t0 + SETTLE, &keep_all);
    t.settle(t0 + SETTLE * 2, SETTLE, &keep_all);
    t.update(&rows(&["b", "c", "d", "> "]), t0 + SETTLE * 2, &keep_all);
    t.settle(t0 + SETTLE * 4, SETTLE, &keep_all);
    assert_eq!(all(&t), vec!["a", "b", ">", "new", "c", "d"]);
}

#[test]
fn spinner_frames_and_borders_never_reach_the_transcript() {
    let mut t = Transcript::new();
    let t0 = Instant::now();
    let keep = |row: &str| !row.starts_with('⠋') && !row.starts_with('⠙');
    t.update(
        &rows(&["╭────╮", "│ reply │", "⠋ working", "╰────╯"]),
        t0,
        &keep,
    );
    t.update(
        &rows(&["╭────╮", "│ reply │", "⠙ working", "╰────╯"]),
        t0,
        &keep,
    );
    t.settle(t0 + SETTLE, SETTLE, &keep);
    assert_eq!(all(&t), vec!["reply"]);
    assert_eq!(clean("│ > text │"), "> text");
}

#[test]
fn read_pages_with_a_cursor_and_a_size_cap() {
    let mut t = Transcript::new();
    let t0 = Instant::now();
    t.update(&rows(&["l1", "l2", "l3"]), t0, &keep_all);
    t.settle(t0 + SETTLE, SETTLE, &keep_all);
    let first = t.read(0, 5);
    assert_eq!(
        (first.text.as_str(), first.next, first.more),
        ("l1\nl2", 2, true)
    );
    let rest = t.read(first.next, 1000);
    assert_eq!((rest.text.as_str(), rest.next, rest.more), ("l3", 3, false));
    let none = t.read(rest.next, 1000);
    assert_eq!((none.text.as_str(), none.next, none.gap), ("", 3, false));
}
