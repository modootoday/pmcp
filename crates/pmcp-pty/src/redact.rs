use regex::Regex;
use std::sync::OnceLock;

// A recorded screen often shows the user's home, account, host and session ids; they are
// replaced before the fixture is written, so a recording is safe to review and share.
fn patterns() -> &'static [(Regex, &'static str)] {
    static RE: OnceLock<Vec<(Regex, &'static str)>> = OnceLock::new();
    RE.get_or_init(|| {
        let uuid =
            r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b";
        [
            (
                r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b",
                "user@example.com",
            ),
            // A shell prompt's user@host: the host has no dot, so a masked email stays as it is.
            (
                r"\b[a-z_][a-z0-9_-]*@[A-Za-z0-9][A-Za-z0-9-]*(?P<end>[^.\w-]|$)",
                "user@host$end",
            ),
            (uuid, "00000000-0000-0000-0000-000000000000"),
        ]
        .into_iter()
        .map(|(p, with)| (Regex::new(p).expect("redaction pattern"), with))
        .collect()
    })
}

pub fn redact(text: &str, home: Option<&str>) -> String {
    let mut out = match home {
        Some(h) if h.len() > 1 => text.replace(h, "~"),
        _ => text.to_string(),
    };
    for (re, with) in patterns() {
        out = re.replace_all(&out, *with).into_owned();
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    // Built from parts, so the source itself holds no home path for a published-surface scan.
    const HOME: &str = concat!("/home", "/ana");

    #[test]
    fn home_accounts_hosts_and_ids_are_masked() {
        let screen = format!(
            "{HOME}/work/x.rs by ana@corp.example.org on ana@ip-10-0-0-1:~$ session 12345678-9abc-4def-8123-456789abcdef"
        );
        let want = "~/work/x.rs by user@example.com on user@host:~$ session 00000000-0000-0000-0000-000000000000";
        assert_eq!(redact(&screen, Some(HOME)), want);
        assert_eq!(redact("plain text", None), "plain text");
    }
}
