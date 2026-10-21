use super::*;
use crate::profile::ProfileSet;
use std::sync::Arc;

fn profile(name: &str) -> Arc<Profile> {
    ProfileSet::parse(crate::profile::BUILTIN)
        .unwrap()
        .get(name)
        .unwrap()
}

fn rows(lines: &[&str]) -> Vec<String> {
    lines.iter().map(|s| s.to_string()).collect()
}

#[test]
fn gemini_numbered_options_inside_a_box() {
    let screen = rows(&[
        "│ 1. earlier list, not options │",
        "│ Allow execution of: 'ls'?    │",
        "│ ● 1. Allow once              │",
        "│   2. Allow always            │",
        "│   3. No, suggest changes (esc) │",
    ]);
    let d = parse_dialog(&profile("gemini"), &screen, "tool-confirm-exec");
    assert_eq!(d["prompt"], "Allow execution of: 'ls'?");
    assert_eq!(
        (d["select"].clone(), d["selected"].clone()),
        (json!("number"), json!("1"))
    );
    assert_eq!(d["options"].as_array().unwrap().len(), 3);
    assert_eq!(d["options"][2]["label"], "No, suggest changes (esc)");
}

// Layouts from live captures of agy 1.4.3 (approval and trust dialogs), 2026-10-20.
#[test]
fn agy_numbered_approval_and_unnumbered_trust_list() {
    let approval = rows(&[
        "Requesting permission for:",
        "   setsid nohup sh sidecar.sh",
        "Run this command?",
        "> 1. Yes, run command",
        "  2. No, cancel",
        "  ↑/↓ Navigate · tab Amend · ctrl+g edit/expand command",
    ]);
    let d = parse_dialog(&profile("agy"), &approval, "run-command");
    assert_eq!(
        d["options"],
        json!([{ "key": "1", "label": "Yes, run command" }, { "key": "2", "label": "No, cancel" }])
    );
    assert_eq!(d["selected"], "1");

    let trust = rows(&[
        "Do you trust the contents of this project?",
        "",
        "Antigravity CLI requires permission to read, edit, and execute files here.",
        "",
        "> Yes, I trust this folder",
        "  No, exit",
        "",
        "  ↑/↓ Navigate · enter Confirm",
    ]);
    let d = parse_dialog(&profile("agy"), &trust, "project-trust");
    assert_eq!(d["select"], "arrows");
    assert_eq!(
        d["options"],
        json!([{ "key": "1", "label": "Yes, I trust this folder" }, { "key": "2", "label": "No, exit" }])
    );
    assert_eq!(d["selected"], "1");
}

// From grok 1.0.62 binary strings (no live capture): letter-key trust options.
#[test]
fn grok_letter_key_trust_options() {
    let screen = rows(&[
        "Do you trust the contents of this directory?",
        "  y  Yes, proceed",
        "  n  No, quit",
        "Enter or y to trust",
    ]);
    let d = parse_dialog(&profile("grok"), &screen, "directory-trust");
    assert_eq!(d["select"], "letter");
    assert_eq!(
        d["options"],
        json!([{ "key": "y", "label": "Yes, proceed" }, { "key": "n", "label": "No, quit" }])
    );
}

// Layout from a live capture of claude 2.1.304's question dialog, 2026-10-19.
#[test]
fn claude_question_options_sit_above_the_hint_row_and_skip_rules() {
    let screen = rows(&[
        "❯ 1. Edit",
        "  2. Cancel",
        "  3. Type something.",
        "──────",
        "  4. Chat about this",
        "Enter to select · ↑/↓ to navigate · Esc to cancel",
    ]);
    let d = parse_dialog(&profile("claude"), &screen, "question");
    assert_eq!(d["select"], "number");
    assert_eq!(d["selected"], "1");
    let labels: Vec<&str> = d["options"]
        .as_array()
        .unwrap()
        .iter()
        .map(|o| o["label"].as_str().unwrap())
        .collect();
    assert_eq!(
        labels,
        ["Edit", "Cancel", "Type something.", "Chat about this"]
    );
}

#[test]
fn a_dialog_without_recognisable_options_says_so() {
    let screen = rows(&["Allow execution of: 'rm'?", "", "press enter"]);
    let d = parse_dialog(&profile("gemini"), &screen, "tool-confirm-exec");
    assert_eq!(
        (d["options"].clone(), d["select"].clone()),
        (json!([]), Value::Null)
    );
}
