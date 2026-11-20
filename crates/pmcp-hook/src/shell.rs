use regex::Regex;
use serde::Deserialize;
use std::sync::OnceLock;

#[derive(Debug, Clone, Deserialize, Default)]
pub struct ValueCommand {
    pub binary: String,
    #[serde(default)]
    pub read: Vec<String>,
    #[serde(default)]
    pub publish: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RawFinding {
    Allow,
    Ask(String),
    Deny(String),
}

// Split a shell command into pipeline/list segments while ignoring quoted delimiters.
pub fn split_segments(cmd: &str) -> Vec<(String, bool)> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut in_single = false;
    let mut in_double = false;
    let mut escaped = false;
    let mut piped_in = false;
    let chars: Vec<char> = cmd.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if escaped {
            cur.push(c);
            escaped = false;
            i += 1;
            continue;
        }
        if c == '\\' && !in_single {
            escaped = true;
            cur.push(c);
            i += 1;
            continue;
        }
        if c == '\'' && !in_double {
            in_single = !in_single;
            cur.push(c);
            i += 1;
            continue;
        }
        if c == '"' && !in_single {
            in_double = !in_double;
            cur.push(c);
            i += 1;
            continue;
        }
        if !in_single && !in_double {
            let next = chars.get(i + 1).copied();
            if c == ';' || c == '\n' {
                if !cur.trim().is_empty() {
                    out.push((cur.trim().to_string(), piped_in));
                }
                cur.clear();
                piped_in = false;
                i += 1;
                continue;
            }
            if (c == '&' && next == Some('&')) || (c == '|' && next == Some('|')) {
                if !cur.trim().is_empty() {
                    out.push((cur.trim().to_string(), piped_in));
                }
                cur.clear();
                piped_in = false;
                i += 2;
                continue;
            }
            if c == '|' {
                if !cur.trim().is_empty() {
                    out.push((cur.trim().to_string(), piped_in));
                }
                cur.clear();
                piped_in = true;
                i += 1;
                continue;
            }
        }
        cur.push(c);
        i += 1;
    }
    if !cur.trim().is_empty() {
        out.push((cur.trim().to_string(), piped_in));
    }
    out
}

pub fn tokenize(seg: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut cur = String::new();
    let mut in_single = false;
    let mut in_double = false;
    let mut escaped = false;
    for c in seg.chars() {
        if escaped {
            cur.push(c);
            escaped = false;
            continue;
        }
        if c == '\\' && !in_single {
            escaped = true;
            continue;
        }
        if c == '\'' && !in_double {
            in_single = !in_single;
            continue;
        }
        if c == '"' && !in_single {
            in_double = !in_double;
            continue;
        }
        if !in_single && !in_double && c.is_whitespace() {
            if !cur.is_empty() {
                tokens.push(std::mem::take(&mut cur));
            }
            continue;
        }
        cur.push(c);
    }
    if !cur.is_empty() {
        tokens.push(cur);
    }
    tokens
}

// Strip leading env assignments and wrappers (env, command, sudo) to find the real binary.
pub fn unwrap_command(tokens: &[String]) -> (&[String], bool) {
    let mut idx = 0;
    let mut bounded_timeout = false;
    while idx < tokens.len() {
        let t = &tokens[idx];
        if matches!(t.as_str(), "while" | "until" | "if" | "then" | "do" | "!") {
            idx += 1;
            continue;
        }
        if t.contains('=') && !t.starts_with('-') && !t.starts_with('/') {
            idx += 1;
            continue;
        }
        if matches!(t.as_str(), "env" | "command" | "sudo" | "xargs") {
            idx += 1;
            while idx < tokens.len() && tokens[idx].starts_with('-') {
                idx += 1;
            }
            continue;
        }
        if t == "timeout" {
            bounded_timeout = true;
            idx += 1;
            while idx < tokens.len() && tokens[idx].starts_with('-') {
                idx += 1;
            }
            if idx < tokens.len() {
                idx += 1;
            }
            continue;
        }
        break;
    }
    (&tokens[idx..], bounded_timeout)
}

fn subshell_script(inner: &[String]) -> Option<&str> {
    let bin = inner.first().map(|s| basename(s))?;
    if !matches!(bin, "bash" | "sh" | "zsh" | "dash") {
        return None;
    }
    let mut i = 1;
    while i < inner.len() {
        let a = &inner[i];
        if (a == "-c" || a == "-lc" || a == "-ic") && i + 1 < inner.len() {
            return Some(&inner[i + 1]);
        }
        i += 1;
    }
    None
}

fn has_short_flag(arg: &str, ch: char) -> bool {
    arg.starts_with('-') && !arg.starts_with("--") && arg[1..].contains(ch)
}

pub fn check_in_place_edit(cmd: &str) -> RawFinding {
    for (seg, _) in split_segments(cmd) {
        let toks = tokenize(&seg);
        let (inner, _) = unwrap_command(&toks);
        if let Some(script) = subshell_script(inner) {
            let nested = check_in_place_edit(script);
            if nested != RawFinding::Allow {
                return nested;
            }
        }
        let Some(bin) = inner.first().map(|s| basename(s)) else {
            continue;
        };
        if matches!(bin, "sed" | "perl" | "awk" | "gawk") {
            for arg in &inner[1..] {
                let is_in_place = arg == "--in-place"
                    || arg.starts_with("--in-place=")
                    || (bin != "awk" && bin != "gawk" && has_short_flag(arg, 'i'))
                    || arg == "-i";
                if is_in_place {
                    return RawFinding::Deny(format!(
                        "in-place stream editor ({bin} {arg}) is denied; use the edit tool"
                    ));
                }
            }
        }
    }
    RawFinding::Allow
}

pub fn check_heredoc(cmd: &str) -> RawFinding {
    let mut in_single = false;
    let mut in_double = false;
    let mut escaped = false;
    let mut arith_depth = 0usize;
    let chars: Vec<char> = cmd.chars().collect();
    let mut i = 0;
    while i + 1 < chars.len() {
        let c = chars[i];
        if escaped {
            escaped = false;
            i += 1;
            continue;
        }
        if c == '\\' && !in_single {
            escaped = true;
            i += 1;
            continue;
        }
        if c == '\'' && !in_double {
            in_single = !in_single;
            i += 1;
            continue;
        }
        if c == '"' && !in_single {
            in_double = !in_double;
            i += 1;
            continue;
        }
        if !in_single && !in_double {
            if c == '(' && chars[i + 1] == '(' {
                arith_depth += 1;
                i += 2;
                continue;
            }
            if arith_depth > 0 && c == ')' && chars[i + 1] == ')' {
                arith_depth -= 1;
                i += 2;
                continue;
            }
            if arith_depth == 0 && c == '<' && chars[i + 1] == '<' {
                return RawFinding::Deny("heredocs and here-strings are denied".into());
            }
        }
        i += 1;
    }
    for (seg, _) in split_segments(cmd) {
        let toks = tokenize(&seg);
        let (inner, _) = unwrap_command(&toks);
        if let Some(script) = subshell_script(inner) {
            let nested = check_heredoc(script);
            if nested != RawFinding::Allow {
                return nested;
            }
        }
    }
    RawFinding::Allow
}

pub fn check_stdin_interpreter(cmd: &str) -> RawFinding {
    for (seg, piped_in) in split_segments(cmd) {
        let toks = tokenize(&seg);
        let (inner, _) = unwrap_command(&toks);
        let Some(bin) = inner.first().map(|s| basename(s)) else {
            continue;
        };
        if !matches!(bin, "python" | "python3") {
            continue;
        }
        let args = &inner[1..];
        let reads_dash = args.iter().any(|a| a == "-");
        let has_inline = !reads_dash
            && args.iter().any(|a| {
                matches!(
                    a.as_str(),
                    "-c" | "-m" | "-V" | "--version" | "-h" | "--help"
                )
            });
        if has_inline {
            continue;
        }
        let has_redirect_in = seg.contains('<');
        let mut has_script = false;
        let mut skip_next = false;
        for a in args {
            if skip_next {
                skip_next = false;
                continue;
            }
            if a == "<" || a == ">" || a == ">>" {
                skip_next = true;
                continue;
            }
            if !a.starts_with('-') && !a.contains('<') && !a.contains('>') {
                has_script = true;
                break;
            }
        }
        if reads_dash || ((piped_in || has_redirect_in) && !has_script) {
            return RawFinding::Ask(format!(
                "running {bin} from stdin is denied; pass a script file or -c"
            ));
        }
    }
    RawFinding::Allow
}

pub fn check_compose_teardown(cmd: &str) -> RawFinding {
    for (seg, _) in split_segments(cmd) {
        let toks = tokenize(&seg);
        let (inner, _) = unwrap_command(&toks);
        let Some(bin) = inner.first().map(|s| basename(s)) else {
            continue;
        };
        let start = if bin == "docker" && inner.get(1).map(String::as_str) == Some("compose") {
            2
        } else if bin == "docker-compose" {
            1
        } else {
            continue;
        };
        let mut i = start;
        let mut sub: Option<&str> = None;
        while i < inner.len() {
            let a = inner[i].as_str();
            if matches!(a, "-f" | "--file" | "-p" | "--project-name" | "--profile") {
                i += 2;
                continue;
            }
            if a.starts_with('-') {
                i += 1;
                continue;
            }
            sub = Some(a);
            i += 1;
            break;
        }
        let Some(subcmd) = sub else {
            continue;
        };
        if subcmd == "down" {
            return RawFinding::Deny("docker compose down is denied".into());
        }
        if matches!(subcmd, "stop" | "rm" | "kill") {
            let mut has_service = false;
            while i < inner.len() {
                let a = inner[i].as_str();
                if matches!(a, "-t" | "--timeout" | "-s" | "--signal") {
                    i += 2;
                    continue;
                }
                if a.starts_with('-') {
                    i += 1;
                    continue;
                }
                has_service = true;
                break;
            }
            if !has_service {
                return RawFinding::Deny(format!(
                    "docker compose {subcmd} without service is denied"
                ));
            }
        }
    }
    RawFinding::Allow
}

pub fn check_runaway_regex(cmd: &str) -> RawFinding {
    static ERE_COUNT_RE: OnceLock<Regex> = OnceLock::new();
    static BRE_COUNT_RE: OnceLock<Regex> = OnceLock::new();
    static NESTED_RE: OnceLock<Regex> = OnceLock::new();
    let ere_count_re =
        ERE_COUNT_RE.get_or_init(|| Regex::new(r"\\*\{(?:\d+,)?(\d+)\\*\}").unwrap());
    let bre_count_re =
        BRE_COUNT_RE.get_or_init(|| Regex::new(r"\\+\{(?:\d+,)?(\d+)\\+\}").unwrap());
    let nested_re = NESTED_RE.get_or_init(|| {
        Regex::new(r"\((?:[^()]|\([^()]*\))*[+*](?:[^()]|\([^()]*\))*\)[+*]").unwrap()
    });
    for (seg, _) in split_segments(cmd) {
        let toks = tokenize(&seg);
        let (inner, bounded_timeout) = unwrap_command(&toks);
        if bounded_timeout {
            continue;
        }
        let Some(bin) = inner.first().map(|s| basename(s)) else {
            continue;
        };
        let is_grep = matches!(bin, "grep" | "egrep" | "pcregrep")
            || (bin == "git" && inner.get(1).map(String::as_str) == Some("grep"));
        if !is_grep {
            continue;
        }
        if inner
            .iter()
            .any(|a| a == "--fixed-strings" || has_short_flag(a, 'F'))
        {
            continue;
        }
        let is_ere = matches!(bin, "egrep" | "pcregrep")
            || inner.iter().any(|a| {
                a == "--extended-regexp"
                    || a == "--perl-regexp"
                    || has_short_flag(a, 'E')
                    || has_short_flag(a, 'P')
            });
        let count_re = if is_ere { ere_count_re } else { bre_count_re };
        for arg in &inner[1..] {
            if let Some(caps) = count_re.captures(arg)
                && let Ok(upper) = caps[1].parse::<u32>()
                && upper >= 250
            {
                return RawFinding::Deny(format!(
                    "runaway regex repetition ({upper}) without timeout is denied"
                ));
            }
            if nested_re.is_match(arg) {
                return RawFinding::Deny(
                    "nested quantifier regex without timeout is denied".into(),
                );
            }
        }
    }
    RawFinding::Allow
}

pub fn check_self_matching_wait(cmd: &str) -> RawFinding {
    let mut in_wait_loop = false;
    let mut in_for_header = false;
    let mut saw_broad_ps = false;
    for (seg, _) in split_segments(cmd) {
        let toks = tokenize(&seg);
        let (inner, _) = unwrap_command(&toks);
        if let Some(script) = subshell_script(inner) {
            let nested = check_self_matching_wait(script);
            if nested != RawFinding::Allow {
                return nested;
            }
        }
        if toks.iter().any(|t| matches!(t.as_str(), "while" | "until")) {
            in_wait_loop = true;
            in_for_header = false;
        } else if toks.iter().any(|t| t == "for") {
            in_for_header = true;
        }
        if in_for_header && toks.iter().any(|t| t == "do") {
            in_wait_loop = true;
            in_for_header = false;
        }
        if toks.iter().any(|t| t == "done") {
            in_wait_loop = false;
            in_for_header = false;
            saw_broad_ps = false;
        }
        if in_wait_loop
            && inner.iter().any(|t| {
                (t.contains("pgrep") || t.contains("pkill"))
                    && (t.contains("-f")
                        || t.contains("--full")
                        || seg.contains("pgrep -f")
                        || seg.contains("pgrep -af")
                        || seg.contains("pkill -f"))
            })
        {
            return RawFinding::Deny("self-matching wait loop can match its own shell".into());
        }
        let Some(bin) = inner.first().map(|s| basename(s)) else {
            continue;
        };
        if bin == "ps" && !inner.iter().any(|a| a == "-p" || a.starts_with("--pid")) {
            saw_broad_ps = true;
        }
        let is_pgrep_f = matches!(bin, "pgrep" | "pkill")
            && inner
                .iter()
                .any(|a| a == "--full" || has_short_flag(a, 'f'));
        if in_wait_loop && (is_pgrep_f || (bin == "grep" && saw_broad_ps)) {
            return RawFinding::Deny("self-matching wait loop can match its own shell".into());
        }
    }
    RawFinding::Allow
}

pub fn check_secret_exfiltration(
    cmd: &str,
    extra_secret_paths: &[String],
    value_commands: &[ValueCommand],
) -> RawFinding {
    let segs = split_segments(cmd);
    let has_network_sink = segs.iter().any(|(seg, piped_in)| {
        let toks = tokenize(seg);
        let (inner, _) = unwrap_command(&toks);
        let bin = inner.first().map(|s| basename(s)).unwrap_or("");
        *piped_in && matches!(bin, "curl" | "wget" | "nc" | "ncat" | "ssh" | "scp")
    });

    let extra_res: Vec<Regex> = extra_secret_paths
        .iter()
        .filter_map(|p| Regex::new(p).ok())
        .collect();

    let mut saw_secret_read = false;
    for (seg, _) in &segs {
        let toks = tokenize(seg);
        let (inner, _) = unwrap_command(&toks);
        let Some(bin) = inner.first().map(|s| basename(s)) else {
            continue;
        };
        for vc in value_commands {
            if bin == vc.binary {
                let rest = inner[1..].join(" ");
                if vc.publish.iter().any(|p| rest.starts_with(p)) {
                    return RawFinding::Deny(format!("secret publish via {bin} is denied"));
                }
                if vc.read.iter().any(|r| rest.starts_with(r)) {
                    if has_network_sink {
                        return RawFinding::Deny(format!(
                            "secret read via {bin} piped to network is denied"
                        ));
                    }
                    saw_secret_read = true;
                }
            }
        }
        if matches!(bin, "ls" | "stat" | "wc" | "find" | "chmod" | "test" | "[") {
            continue;
        }
        if !matches!(
            bin,
            "cat"
                | "head"
                | "tail"
                | "less"
                | "more"
                | "sed"
                | "awk"
                | "grep"
                | "rg"
                | "printenv"
                | "env"
        ) {
            continue;
        }
        for arg in &inner[1..] {
            if arg.starts_with('-') {
                continue;
            }
            if is_secret_path(arg, &extra_res) {
                if has_network_sink {
                    return RawFinding::Deny(format!(
                        "exfiltrating secret file ({arg}) to network is denied"
                    ));
                }
                saw_secret_read = true;
            }
        }
    }
    if saw_secret_read {
        return RawFinding::Ask(
            "reading a secret file or credential store requires approval".into(),
        );
    }
    RawFinding::Allow
}

fn is_secret_path(path: &str, extra: &[Regex]) -> bool {
    let base = basename(path);
    if base.ends_with(".example") || base.ends_with(".sample") || base.ends_with(".template") {
        return false;
    }
    if base == ".env"
        || base.starts_with(".env.")
        || base == ".dev.vars"
        || base == ".npmrc"
        || base.ends_with(".pem")
        || base.ends_with(".key")
    {
        return true;
    }
    extra.iter().any(|re| re.is_match(path))
}

pub fn basename(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}
