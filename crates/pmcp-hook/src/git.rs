use crate::shell::{RawFinding, basename, split_segments, tokenize, unwrap_command};

fn git_subcommand(inner: &[String]) -> Option<(&str, &[String])> {
    let bin = inner.first().map(|s| basename(s))?;
    if bin != "git" {
        return None;
    }
    let mut i = 1;
    while i < inner.len() {
        let a = inner[i].as_str();
        if matches!(
            a,
            "-C" | "-c" | "--config-env" | "--git-dir" | "--work-tree"
        ) {
            i += 2;
            continue;
        }
        if a.starts_with('-') {
            i += 1;
            continue;
        }
        return Some((a, &inner[i + 1..]));
    }
    None
}

fn names_hooks_path(entry: &str) -> bool {
    entry
        .split('=')
        .next()
        .is_some_and(|key| key.eq_ignore_ascii_case("core.hookspath"))
}

// Global options before the subcommand that set core.hooksPath for this one command.
fn overrides_hooks(inner: &[String]) -> bool {
    let mut i = 1;
    while i < inner.len() {
        let a = inner[i].as_str();
        if matches!(a, "-c" | "--config-env") {
            if inner.get(i + 1).is_some_and(|v| names_hooks_path(v)) {
                return true;
            }
            i += 2;
            continue;
        }
        if let Some(entry) = a.strip_prefix("--config-env=")
            && names_hooks_path(entry)
        {
            return true;
        }
        if matches!(a, "-C" | "--git-dir" | "--work-tree") {
            i += 2;
            continue;
        }
        if !a.starts_with('-') {
            return false;
        }
        i += 1;
    }
    false
}

// Git reads these as configuration for the one command, so they can point core.hooksPath away.
fn sets_config_env(prefix: &[String]) -> bool {
    prefix
        .iter()
        .any(|t| t.starts_with("GIT_CONFIG_PARAMETERS=") || t.starts_with("GIT_CONFIG_COUNT="))
}

pub fn check_push_without_verify(cmd: &str) -> RawFinding {
    for (seg, _) in split_segments(cmd) {
        let toks = tokenize(&seg);
        let (inner, _) = unwrap_command(&toks);
        let prefix = &toks[..toks.len() - inner.len()];
        if let Some(("push", args)) = git_subcommand(inner)
            && (args.iter().any(|a| a == "--no-verify")
                || overrides_hooks(inner)
                || sets_config_env(prefix))
        {
            return RawFinding::Deny("git push without its pre-push hooks is denied".into());
        }
    }
    RawFinding::Allow
}

pub fn check_forced_branch_move(cmd: &str) -> RawFinding {
    for (seg, _) in split_segments(cmd) {
        let toks = tokenize(&seg);
        let (inner, _) = unwrap_command(&toks);
        if let Some(("branch", args)) = git_subcommand(inner)
            && args
                .iter()
                .any(|a| matches!(a.as_str(), "-f" | "--force" | "-M"))
        {
            return RawFinding::Deny("forced git branch move is denied".into());
        }
    }
    RawFinding::Allow
}

pub fn check_stage_all(cmd: &str) -> RawFinding {
    for (seg, _) in split_segments(cmd) {
        let toks = tokenize(&seg);
        let (inner, _) = unwrap_command(&toks);
        if let Some(("add", args)) = git_subcommand(inner)
            && args
                .iter()
                .any(|a| matches!(a.as_str(), "-A" | "--all" | "."))
        {
            return RawFinding::Deny("git add -A/--all/. is denied; name explicit paths".into());
        }
    }
    RawFinding::Allow
}

pub fn check_discard_work(cmd: &str) -> RawFinding {
    for (seg, _) in split_segments(cmd) {
        let toks = tokenize(&seg);
        let (inner, _) = unwrap_command(&toks);
        match git_subcommand(inner) {
            Some(("reset", args)) if args.iter().any(|a| a == "--hard") => {
                return RawFinding::Ask("git reset --hard discards uncommitted work".into());
            }
            Some(("clean", args)) if args.iter().any(|a| a.starts_with('-') && a.contains('f')) => {
                return RawFinding::Ask("git clean -f removes untracked files".into());
            }
            Some(("checkout", args)) if args.iter().any(|a| a == "--") => {
                return RawFinding::Ask("git checkout -- discards working tree changes".into());
            }
            _ => {}
        }
    }
    RawFinding::Allow
}

pub fn check_gate_bypass_env(cmd: &str, names: &[String], no_verify: bool) -> RawFinding {
    for (seg, _) in split_segments(cmd) {
        let toks = tokenize(&seg);
        for tok in &toks {
            for name in names {
                if tok.starts_with(&format!("{name}=")) {
                    return RawFinding::Deny(format!("gate bypass env {name} is denied"));
                }
            }
        }
        if no_verify {
            let (inner, _) = unwrap_command(&toks);
            if let Some((_, args)) = git_subcommand(inner)
                && args.iter().any(|a| a == "--no-verify")
            {
                return RawFinding::Deny("git --no-verify is denied".into());
            }
        }
    }
    RawFinding::Allow
}

pub fn check_mainline_deliver(cmd: &str, branch: &str) -> RawFinding {
    for (seg, _) in split_segments(cmd) {
        let toks = tokenize(&seg);
        let (inner, _) = unwrap_command(&toks);
        if let Some(("push", args)) = git_subcommand(inner) {
            if args
                .iter()
                .any(|a| matches!(a.as_str(), "-n" | "--dry-run"))
            {
                continue;
            }
            let targets_main = args.iter().any(|a| {
                a == branch
                    || a.ends_with(&format!(":{branch}"))
                    || a.ends_with(&format!(":refs/heads/{branch}"))
            });
            if targets_main {
                return RawFinding::Deny(format!(
                    "direct push to mainline {branch} is denied; use git:land / pmcp git deliver"
                ));
            }
        }
    }
    RawFinding::Allow
}
