use crate::profile::Profile;
use crate::transcript::clean;
use regex::Regex;
use serde_json::{Value, json};
use std::sync::OnceLock;

// Options below a dialog's prompt come in three shapes across the six runtimes: numbered rows
// (gemini, codex, agy approvals), letter keys (grok trust: "y  Yes, proceed") and a marked list
// without keys (agy trust: "> Yes, I trust this folder"). select says how to choose one.
const OPTION_ROWS: usize = 12;
const MARK: &str = "[›❯>●◉*]";

fn numbered() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        let p = format!(r"^(?P<mark>{MARK}\s*)?(?P<key>\d{{1,2}})[.)]\s+(?P<label>\S.*?)\s*$");
        Regex::new(&p).expect("numbered option")
    })
}

fn lettered() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        let p = format!(r"^(?P<mark>{MARK}\s*)?(?P<key>[a-z])\s{{2,}}(?P<label>\S.*?)\s*$");
        Regex::new(&p).expect("lettered option")
    })
}

fn marked() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(&format!(r"^{MARK}\s+(?P<label>\S.*?)\s*$")).expect("marked"))
}

fn keyed(rows: &[String], re: &Regex) -> (Vec<Value>, Value) {
    let mut options = Vec::new();
    let mut selected = Value::Null;
    for row in rows {
        let Some(c) = re.captures(row) else { continue };
        let key = c["key"].to_string();
        if c.name("mark").is_some() {
            selected = json!(key);
        }
        options.push(json!({ "key": key, "label": c["label"].to_string() }));
    }
    (options, selected)
}

fn label_column(row: &str) -> usize {
    row.chars().take_while(|c| c.is_whitespace()).count()
}

fn is_hint(row: &str) -> bool {
    row.contains("↑/↓") || row.contains(" · ")
}

// A marked list: the marked row and its neighbours whose text starts in the marked label's
// column (agy draws "> Yes" over "  No, exit"), stopping at key-hint rows.
fn listed(raw: &[String]) -> (Vec<Value>, Value) {
    let rows: Vec<String> = raw
        .iter()
        .map(|r| r.trim_start_matches('│').trim_end().to_string())
        .collect();
    let Some(at) = rows.iter().position(|r| marked().is_match(r.trim_start())) else {
        return (Vec::new(), Value::Null);
    };
    let marked_row = rows[at].trim_start();
    let label = marked()
        .captures(marked_row)
        .map(|c| c["label"].to_string())
        .unwrap_or_default();
    let column = label_column(&rows[at]) + marked_row.chars().count() - label.chars().count();
    let member = |r: &String| !is_hint(r) && !r.trim().is_empty() && label_column(r) == column;
    let first = rows[..at]
        .iter()
        .rposition(|r| !member(r))
        .map_or(0, |i| i + 1);
    let last = rows[at + 1..]
        .iter()
        .position(|r| !member(r))
        .map_or(rows.len(), |i| at + 1 + i);
    let options = (first..last)
        .map(|i| {
            let text = match i == at {
                true => label.clone(),
                false => rows[i].trim().to_string(),
            };
            json!({ "key": (i - first + 1).to_string(), "label": text })
        })
        .collect();
    (options, json!((at - first + 1).to_string()))
}

fn options_in(raw: &[String]) -> (&'static str, Vec<Value>, Value) {
    let rows: Vec<String> = raw.iter().map(|r| clean(r)).collect();
    let (options, selected) = keyed(&rows, numbered());
    if !options.is_empty() {
        return ("number", options, selected);
    }
    let (options, selected) = keyed(&rows, lettered());
    if !options.is_empty() {
        return ("letter", options, selected);
    }
    let (options, selected) = listed(raw);
    ("arrows", options, selected)
}

pub fn parse_dialog(profile: &Profile, rows: &[String], name: &str) -> Value {
    let text = rows.join("\n");
    let prompt = profile.dialog_line(&text).map(clean);
    let start = prompt
        .as_ref()
        .and_then(|p| rows.iter().position(|r| clean(r) == *p))
        .map_or(0, |i| i + 1);
    // Options usually follow the prompt; Claude's question dialog matches on the hint row under them.
    let below: Vec<String> = rows.iter().skip(start).take(OPTION_ROWS).cloned().collect();
    let first = start.saturating_sub(OPTION_ROWS + 1);
    let above: Vec<String> = rows[first..start.saturating_sub(1)].to_vec();
    let (mut select, mut options, mut selected) = options_in(&below);
    if options.is_empty() {
        (select, options, selected) = options_in(&above);
    }
    let select = match options.is_empty() {
        true => Value::Null,
        false => json!(select),
    };
    json!({ "name": name, "prompt": prompt, "options": options, "selected": selected, "select": select })
}

#[cfg(test)]
#[path = "dialog_tests.rs"]
mod tests;
