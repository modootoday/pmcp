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
        if t == "env" || t == "command" || t == "sudo" {
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

pub fn check_in_place_edit(cmd: &str) -> RawFinding {
    for (seg, _) in split_segments(cmd) {
        let toks = tokenize(&seg);
        let (inner, _) = unwrap_command(&toks);
        let Some(bin) = inner.first().map(|s| basename(s)) else {
            continue;
        };
        if matches!(bin, "sed" | "perl" | "awk" | "gawk") {
            for arg in &inner[1..] {
                if arg == "-i"
                    || arg == "--in-place"
                    || (arg.starts_with("-i") && bin != "awk" && bin != "gawk")
                    || arg.starts_with("--in-place=")
                {
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
        if !in_single && !in_double && c == '<' && chars[i + 1] == '<' {
            return RawFinding::Deny("heredocs and here-strings are denied".into());
        }
        i += 1;
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
        let has_inline = args.iter().any(|a| {
            matches!(
                a.as_str(),
                "-c" | "-m" | "-V" | "--version" | "-h" | "--help"
            )
        });
        if has_inline {
            continue;
        }
        let reads_dash = args.iter().any(|a| a == "-");
        let has_redirect_in = seg.contains('<');
        let has_script = args
            .iter()
            .any(|a| !a.starts_with('-') && !a.starts_with('<'));
        if reads_dash || ((piped_in || has_redirect_in) && !has_script) {
            return RawFinding::Deny(format!(
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
        let is_compose = (bin == "docker" && inner.get(1).map(String::as_str) == Some("compose"))
            || bin == "docker-compose";
        if !is_compose {
            continue;
        }
        let has_down = inner.iter().any(|a| a == "down");
        let has_volumes = inner
            .iter()
            .any(|a| a == "-v" || a == "--volumes" || a == "--rmi");
        if has_down && has_volumes {
            return RawFinding::Deny("docker compose teardown with volume removal is denied".into());
        }
    }
    RawFinding::Allow
}

pub fn check_runaway_regex(cmd: &str) -> RawFinding {
    static COUNT_RE: OnceLock<Regex> = OnceLock::new();
    static NESTED_RE: OnceLock<Regex> = OnceLock::new();
    let count_re = COUNT_RE.get_or_init(|| Regex::new(r"\{(\d*),(\d+)\}").unwrap());
    let nested_re = NESTED_RE.get_or_init(|| Regex::new(r"\([^)]*[+*][^)]*\)[+*]").unwrap());
    for (seg, _) in split_segments(cmd) {
        let toks = tokenize(&seg);
        let (inner, bounded_timeout) = unwrap_command(&toks);
        if bounded_timeout {
            continue;
        }
        let Some(bin) = inner.first().map(|s| basename(s)) else {
            continue;
        };
        if !matches!(bin, "grep" | "egrep" | "rg" | "pcregrep") {
            continue;
        }
        for arg in &inner[1..] {
            if let Some(caps) = count_re.captures(arg) {
                if let Ok(upper) = caps[2].parse::<u32>() {
                    if upper >= 1000 {
                        return RawFinding::Deny(format!(
                            "runaway regex repetition ({upper}) without timeout is denied"
                        ));
                    }
                }
            }
            if nested_re.is_match(arg) {
                return RawFinding::Deny("nested quantifier regex without timeout is denied".into());
            }
        }
    }
    RawFinding::Allow
}

pub fn check_self_matching_wait(cmd: &str) -> RawFinding {
    for (seg, _) in split_segments(cmd) {
        let toks = tokenize(&seg);
        let (inner, _) = unwrap_command(&toks);
        let Some(bin) = inner.first().map(|s| basename(s)) else {
            continue;
        };
        if matches!(bin, "pgrep" | "pkill")
            && inner.iter().any(|a| a == "-f" || a == "--full")
            && (cmd.contains("while ") || cmd.contains("until "))
        {
            return RawFinding::Deny(
                "self-matching pgrep/pkill -f wait loop can match its own shell".into(),
            );
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
            "cat" | "head" | "tail" | "less" | "more" | "sed" | "awk" | "grep" | "rg" | "printenv" | "env"
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
        return RawFinding::Ask("reading a secret file or credential store requires approval".into());
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
