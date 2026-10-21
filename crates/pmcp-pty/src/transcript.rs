use std::collections::{HashMap, VecDeque};
use std::time::{Duration, Instant};

// A line log built from the rendered screen: a row is committed when it scrolls off or stays
// unchanged for the settle time. Committed rows still on screen are counted in shown, so a
// redraw that moves a line does not commit it twice.
const KEEP_LINES: usize = 5000;

pub struct Transcript {
    lines: VecDeque<String>,
    first: u64,
    rows: Vec<(String, Instant)>,
    shown: HashMap<String, usize>,
}

pub struct Page {
    pub text: String,
    pub next: u64,
    pub gap: bool,
    pub more: bool,
}

fn is_border(c: char) -> bool {
    ('\u{2500}'..='\u{259f}').contains(&c) || c.is_whitespace()
}

// Box-drawing frames and block elements (gemini's half-block box, grok's scrollbar) carry no
// text, so they are trimmed from both ends.
pub fn clean(row: &str) -> String {
    row.trim_matches(is_border).to_string()
}

// Rows that moved up by k between two frames, ignoring an unchanged footer such as an input box.
fn scroll_shift(old: &[String], new: &[String]) -> (usize, usize) {
    let h = old.len().min(new.len());
    let footer = (0..h)
        .take_while(|i| old[old.len() - 1 - i] == new[new.len() - 1 - i])
        .count();
    let body = h - footer;
    for k in 1..body {
        let overlap = &old[k..body];
        if overlap.iter().any(|r| !r.is_empty()) && overlap == &new[..body - k] {
            return (k, footer);
        }
    }
    (0, footer)
}

impl Transcript {
    pub fn new() -> Transcript {
        Transcript {
            lines: VecDeque::new(),
            first: 0,
            rows: Vec::new(),
            shown: HashMap::new(),
        }
    }

    pub fn next(&self) -> u64 {
        self.first + self.lines.len() as u64
    }

    fn push(&mut self, line: String) {
        self.lines.push_back(line);
        if self.lines.len() > KEEP_LINES {
            self.lines.pop_front();
            self.first += 1;
        }
    }

    pub fn update(&mut self, raw: &[String], now: Instant, keep: &dyn Fn(&str) -> bool) {
        let new: Vec<String> = raw.iter().map(|r| clean(r)).collect();
        let old: Vec<String> = self.rows.iter().map(|(t, _)| t.clone()).collect();
        let (k, footer) = scroll_shift(&old, &new);
        let body = new.len() - footer;
        for gone in &old[..k] {
            match self.shown.get_mut(gone) {
                Some(n) if *n > 0 => *n -= 1,
                _ if !gone.is_empty() && keep(gone) => self.push(gone.clone()),
                _ => {}
            }
        }
        let rows = new
            .into_iter()
            .enumerate()
            .map(
                |(i, text)| match self.rows.get(if i < body { i + k } else { i }) {
                    Some((was, since)) if *was == text => (text, *since),
                    _ => (text, now),
                },
            )
            .collect();
        self.rows = rows;
        let mut on_screen: HashMap<&str, usize> = HashMap::new();
        for (text, _) in &self.rows {
            *on_screen.entry(text.as_str()).or_default() += 1;
        }
        self.shown.retain(|text, n| {
            *n = (*n).min(on_screen.get(text.as_str()).copied().unwrap_or(0));
            *n > 0
        });
    }

    pub fn settle(&mut self, now: Instant, settle: Duration, keep: &dyn Fn(&str) -> bool) {
        let mut seen: HashMap<String, usize> = HashMap::new();
        let mut fresh = Vec::new();
        for (text, since) in &self.rows {
            if text.is_empty() || now.duration_since(*since) < settle || !keep(text) {
                continue;
            }
            let n = seen.entry(text.clone()).or_default();
            *n += 1;
            if self.shown.get(text).copied().unwrap_or(0) < *n {
                fresh.push(text.clone());
            }
        }
        for text in fresh {
            *self.shown.entry(text.clone()).or_default() += 1;
            self.push(text);
        }
    }

    pub fn read(&self, since: u64, max_chars: usize) -> Page {
        let start = since.max(self.first);
        let mut text = String::new();
        let mut next = start;
        for line in self.lines.iter().skip((start - self.first) as usize) {
            if !text.is_empty() && text.len() + line.len() + 1 > max_chars {
                break;
            }
            if !text.is_empty() {
                text.push('\n');
            }
            text.push_str(line);
            next += 1;
        }
        Page {
            text,
            next,
            gap: since < self.first,
            more: next < self.next(),
        }
    }

    pub fn lines_since(&self, since: u64) -> Vec<String> {
        let skip = since.saturating_sub(self.first) as usize;
        self.lines.iter().skip(skip).cloned().collect()
    }
}

#[cfg(test)]
#[path = "transcript_tests.rs"]
mod tests;
