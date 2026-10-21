// pmcp-pty, pmcp-tui and the plugins run on Linux and macOS. Elsewhere every entry point and
// doctor says so and stops, instead of running with weaker process control or access checks.
pub const SUPPORTED: bool = cfg!(any(target_os = "linux", target_os = "macos"));

/// Why this system is not supported, or None where it is.
pub fn unsupported() -> Option<&'static str> {
    match () {
        _ if SUPPORTED => None,
        _ if cfg!(windows) => Some(
            "Windows is not supported yet: process trees, memory caps and socket access checks have \
             no Windows implementation; use Linux or macOS",
        ),
        _ => Some("this operating system is not supported yet; use Linux or macOS"),
    }
}

/// Why the plugins (Xvfb, systemd scopes, a pinned Linux Chromium) do not run here, or None on
/// Linux; they come to macOS later, separately from pmcp-pty and pmcp-tui.
pub fn plugins_unsupported() -> Option<String> {
    if let Some(why) = unsupported() {
        return Some(why.into());
    }
    cfg!(target_os = "macos").then(|| {
        "macOS: the pmcp plugins run on Linux for now (Xvfb, systemd scopes, a pinned Linux Chromium)"
            .into()
    })
}

/// Stops an entry point on an unsupported system with the reason.
pub fn require(program: &str) -> Result<(), String> {
    match unsupported() {
        Some(why) => Err(format!("{program}: {why}")),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn this_host_is_supported_and_others_get_a_plain_reason() {
        assert_eq!(unsupported(), None);
        assert_eq!(require("pmcp-pty"), Ok(()));
        assert_eq!(plugins_unsupported().is_some(), cfg!(target_os = "macos"));
    }
}
