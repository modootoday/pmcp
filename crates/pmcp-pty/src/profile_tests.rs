use super::*;

fn builtin() -> ProfileSet {
    ProfileSet::parse(BUILTIN).expect("builtin profiles parse")
}

#[test]
fn builtin_profiles_compile_and_cover_target_runtimes() {
    let set = builtin();
    for name in ["default", "gemini", "codex", "agy", "grok"] {
        assert!(set.get(name).is_some(), "missing {name}");
    }
}

#[test]
fn selects_by_argv0_basename_then_falls_back_to_default() {
    let set = builtin();
    assert_eq!(
        set.select(None, "/usr/local/bin/gemini").unwrap().name,
        "gemini"
    );
    assert_eq!(set.select(None, "bash").unwrap().name, "default");
    assert_eq!(set.select(Some("codex"), "bash").unwrap().name, "codex");
    assert!(set.select(Some("nope"), "bash").is_err());
}

#[test]
fn gemini_tool_confirmation_is_a_dialog_with_source() {
    let p = builtin().get("gemini").unwrap();
    let screen = "│ ?  Shell ls -la\n│ Allow execution of: 'ls'?\n│ ● 1. Allow once\n│   3. No, suggest changes (esc)";
    let m = p.observe(screen);
    assert_eq!(m.dialog.as_deref(), Some("tool-confirm-exec"));
    assert!(
        m.dialog_source
            .unwrap()
            .contains("interactiveCli-66E5CZDR.js:12228")
    );
}

#[test]
fn gemini_trust_prompt_is_a_dialog() {
    let p = builtin().get("gemini").unwrap();
    let m = p.observe("Do you trust the files in this folder?\n● 1. Trust folder (work)");
    assert_eq!(m.dialog.as_deref(), Some("folder-trust"));
}

#[test]
fn gemini_idle_input_box_reports_empty_and_not_busy() {
    let p = builtin().get("gemini").unwrap();
    let m = p.observe("╭──────╮\n│ >   Type your message or @path/to/file │\n╰──────╯");
    assert_eq!(
        m,
        ScreenMatch {
            input_empty: Some(true),
            ..Default::default()
        }
    );
    let typed = p.observe("│ > hello world │");
    assert_eq!(typed.input_empty, Some(false));
}

#[test]
fn gemini_spinner_is_busy() {
    let p = builtin().get("gemini").unwrap();
    let m = p.observe("⠋ Thinking about it (esc to cancel, 3s)");
    assert_eq!(m.busy.as_deref(), Some("responding"));
    assert_eq!(m.dialog, None);
}

// The live reply that carried the footer's value row (gemini-cli 0.64.0, 2026-10-20).
#[test]
fn gemini_footer_value_row_is_chrome_and_the_reply_is_not() {
    let p = builtin().get("gemini").unwrap();
    let footer =
        "~/workspace/project                                      main          no sandbox";
    assert!(p.is_chrome(footer));
    assert!(!p.is_chrome("✦ PTY-OK-gemini"));
    assert!(!p.is_chrome("/tmp/x is the file you asked about"));
}

#[test]
fn profile_without_input_patterns_reports_unknown_input_state() {
    let p = builtin().get("default").unwrap();
    assert_eq!(p.observe("anything").input_empty, None);
    assert_eq!(p.draft("> x", "> x"), None);
}

// After a reply, claude shows a dim suggestion in the box; only the typed text counts.
#[test]
fn a_dim_suggestion_is_not_a_draft_and_does_not_fill_the_box() {
    let p = builtin().get("claude").unwrap();
    let rule = "─".repeat(40);
    let screen = format!("{rule}\n❯\u{a0}run the test suite\n{rule}");
    let typed = format!("{rule}\n❯\u{a0}\n{rule}");
    assert_eq!(p.observe(&screen).input_empty, Some(false));
    assert_eq!(p.observe_typed(&screen, &typed).input_empty, Some(true));
    assert_eq!(p.draft(&screen, &typed).as_deref(), Some(""));
    assert_eq!(
        p.draft(&screen, &screen).as_deref(),
        Some("run the test suite")
    );
}

#[test]
fn every_runtime_profile_names_its_version_and_delivery() {
    let set = builtin();
    for name in ["claude", "codex", "gemini", "agy", "grok", "opencode"] {
        let p = set.get(name).unwrap();
        assert!(p.version.is_some(), "{name} has no version");
        assert!(p.delivery.is_some(), "{name} has no delivery");
    }
}

#[test]
fn invalid_regex_is_rejected_with_profile_name() {
    let text = "[profiles.x]\n[[profiles.x.dialogs]]\nname = \"bad\"\nregex = \"(\"\n";
    let err = ProfileSet::parse(text).err().unwrap();
    assert!(err.contains("profile x pattern bad"), "{err}");
}

#[test]
fn spinner_and_busy_rows_are_chrome_and_input_text_is_captured() {
    let text = concat!(
        "[profiles.f]\nsettle_ms = 200\n",
        "[[profiles.f.spinner]]\nname = \"frames\"\nregex = '^[⠋⠙⠹]'\n",
        "[[profiles.f.busy]]\nname = \"working\"\nregex = 'esc to cancel'\n",
        "[profiles.f.input]\nname = \"box\"\nregex = '^> (?P<text>.*)$'\n",
    );
    let p = ProfileSet::parse(text).unwrap().get("f").unwrap();
    assert_eq!(p.settle_ms, 200);
    assert!(p.is_chrome("⠙ thinking"));
    assert!(p.is_chrome("Working (esc to cancel)"));
    assert!(!p.is_chrome("echo: hi"));
    assert_eq!(
        p.input_text("log\n> draft text").as_deref(),
        Some("draft text")
    );
    assert_eq!(builtin().get("grok").unwrap().input_text("> x"), None);
}

// Live runs 2 and 3: the guard reads the box with dim placeholders blanked and rows trimmed,
// so an empty box is a bare mark there, and both runtimes refused every turn before this.
#[test]
fn a_bare_mark_is_an_empty_box_for_claude_and_codex() {
    let set = builtin();
    let codex = set.get("codex").unwrap();
    let screen = "› Ask Codex to do anything";
    assert_eq!(codex.observe_typed(screen, "›").input_empty, Some(true));
    assert_eq!(
        codex.observe_typed(screen, "› fix it").input_empty,
        Some(false)
    );
    let claude = set.get("claude").unwrap();
    let typed = "────────\n❯\n────────";
    assert_eq!(claude.observe_typed(typed, typed).input_empty, Some(true));
    let draft = "────────\n❯ fix it\n────────";
    assert_eq!(claude.observe_typed(draft, draft).input_empty, Some(false));
}
