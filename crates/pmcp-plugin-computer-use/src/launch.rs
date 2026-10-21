use serde_json::Value;
use std::path::Path;

// Apps the desktop may start come only from the operator-approved copy (policy.json
// "desktop.launch"), never from the MCP call or pmcp.toml alone. Browsers are never on it:
// typed into on this display they would bypass pmcp-browser's address allowlist.
const BROWSERS: &[&str] = &[
    "chromium",
    "chromium-browser",
    "chrome",
    "google-chrome",
    "google-chrome-stable",
    "firefox",
    "firefox-esr",
    "epiphany",
    "brave",
    "brave-browser",
    "microsoft-edge",
    "opera",
    "vivaldi",
    "x-www-browser",
];

#[derive(Debug, Clone, PartialEq)]
pub struct App {
    pub name: String,
    pub argv: Vec<String>,
}

pub fn is_browser(program: &str) -> bool {
    let base = program.rsplit('/').next().unwrap_or(program);
    BROWSERS.contains(&base) || base.contains("chrom")
}

/// The approved apps, plus a note for each entry that was dropped and why.
pub fn apps(policy: &Value) -> (Vec<App>, Vec<String>) {
    let mut ok = Vec::new();
    let mut dropped = Vec::new();
    let list = policy["desktop"]["launch"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    for entry in list {
        let name = entry["name"].as_str().unwrap_or_default().to_string();
        let argv: Vec<String> = entry["argv"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();
        match argv.first() {
            None => dropped.push(format!("{name}: no argv")),
            Some(p) if is_browser(p) => {
                dropped.push(format!("{name}: browsers are never launched here"))
            }
            Some(_) if name.is_empty() => dropped.push("an entry without a name".into()),
            Some(_) => ok.push(App { name, argv }),
        }
    }
    (ok, dropped)
}

/// Reads the approved copy at every launch, so a new approval applies without a restart.
pub fn approved(dir: Option<&Path>) -> Result<(Vec<App>, Vec<String>), String> {
    let dir = dir.ok_or("no approved policy (--approved); launch is off")?;
    let text = pmcp_plugin_support::approved::policy_text(dir)?;
    let policy: Value = serde_json::from_str(&text).map_err(|e| format!("policy.json: {e}"))?;
    Ok(apps(&policy))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn only_named_non_browser_apps_with_an_argv_are_kept() {
        let policy = json!({ "desktop": { "launch": [
            { "name": "terminal", "argv": ["xterm"] },
            { "name": "web", "argv": ["/usr/bin/chromium"] },
            { "name": "ff", "argv": ["firefox", "--new-window"] },
            { "name": "empty", "argv": [] }
        ] } });
        let (ok, dropped) = apps(&policy);
        assert_eq!(
            ok,
            [App {
                name: "terminal".into(),
                argv: vec!["xterm".into()]
            }]
        );
        assert_eq!(dropped.len(), 3);
        assert!(approved(None).is_err());
    }
}
