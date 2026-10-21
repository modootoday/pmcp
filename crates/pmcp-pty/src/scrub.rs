use std::collections::BTreeMap;

// A hosted runtime must not inherit the session identity of whatever started the daemon: live,
// a Claude hosted from a Claude session took CLAUDE_CODE_CHILD_SESSION, saved no transcript and
// wrote no session file. Settings such as provider or model variables are left alone.
const NAMES: &[&str] = &[
    "AI_AGENT",
    "CLAUDECODE",
    "CLAUDE_EFFORT",
    "CLAUDE_PID",
    "CODEX_SANDBOX",
    "CODEX_SANDBOX_NETWORK_DISABLED",
    "GEMINI_CLI",
    // The daemon's own identity; spawn sets the child's. PMCP_PTY_BIN and other settings stay.
    "PMCP_PTY_INSTANCE",
    "PMCP_PTY_SESSION",
    "PMCP_PTY_SOCKET",
];

const PREFIXES: &[&str] = &[
    "CLAUDE_CODE_CHILD",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_EXECPATH",
    "CLAUDE_CODE_MESSAGING_",
    "CLAUDE_CODE_SESSION",
    "CLAUDE_CODE_SSE_PORT",
    "CODEX_SESSION",
    "CODEX_THREAD",
    "GROK_SESSION",
    "ANTIGRAVITY_",
    "OPENCODE_PID",
    "OPENCODE_SERVER_",
    "OPENCODE_SESSION",
];

pub fn is_marker(name: &str) -> bool {
    NAMES.contains(&name) || PREFIXES.iter().any(|p| name.starts_with(p))
}

/// The inherited names to remove: markers, except those the request keeps or sets itself.
pub fn markers(
    inherited: impl Iterator<Item = String>,
    keep: &[String],
    explicit: &BTreeMap<String, String>,
) -> Vec<String> {
    let mut out: Vec<String> = inherited
        .filter(|n| is_marker(n) && !keep.contains(n) && !explicit.contains_key(n))
        .collect();
    out.sort();
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_markers_go_and_settings_kept_or_set_by_the_request_stay() {
        let inherited = [
            "CLAUDECODE",
            "CLAUDE_CODE_CHILD_SESSION",
            "CLAUDE_CODE_MESSAGING_SOCKET",
            "CLAUDE_CODE_USE_BEDROCK",
            "CODEX_THREAD_ID",
            "PMCP_PTY_SESSION",
            "PMCP_PTY_BIN",
            "OPENCODE_SERVER_PASSWORD",
            "PATH",
            "GROK_SESSION_ID",
        ];
        let keep = vec!["GROK_SESSION_ID".to_string()];
        let explicit = BTreeMap::from([("OPENCODE_SERVER_PASSWORD".to_string(), "x".to_string())]);
        let got = markers(inherited.iter().map(|s| s.to_string()), &keep, &explicit);
        assert_eq!(
            got,
            [
                "CLAUDECODE",
                "CLAUDE_CODE_CHILD_SESSION",
                "CLAUDE_CODE_MESSAGING_SOCKET",
                "CODEX_THREAD_ID",
                "PMCP_PTY_SESSION",
            ]
        );
    }
}
