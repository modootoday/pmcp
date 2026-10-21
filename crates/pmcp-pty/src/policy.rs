use pmcp_plugin_support::approved::{owned_alone, policy_text};
use serde::Deserialize;
use std::path::Path;

// The operator's policy: which dialog options pmcp-pty may choose, and whether turn and lease
// reach it over MCP. Read on every use, so an operator change applies without a restart.
#[derive(Deserialize, Default, Debug)]
pub struct Policy {
    #[serde(default)]
    pub allow: Vec<Rule>,
    #[serde(default)]
    pub mcp_write: bool,
}

#[derive(Deserialize, Debug)]
pub struct Rule {
    pub profile: String,
    pub dialog: String,
    pub options: Vec<String>,
}

/// Where the daemon takes its policy from, fixed at start like fixtures.
#[derive(Default, Clone)]
pub struct Source {
    /// pmcp's approval dir: host.json, policy.json and approval.json the operator approved.
    pub host: Option<std::path::PathBuf>,
    /// An operator-written TOML file (the form before approvals existed).
    pub answers: Option<std::path::PathBuf>,
}

// The approval check is the plugins' too (pmcp-plugin-support), so one copy decides for all.
fn from_host(dir: &Path) -> Result<Policy, String> {
    let policy = policy_text(dir)?;
    serde_json::from_str(&policy).map_err(|e| format!("policy.json: {e}"))
}

fn from_answers(path: &Path) -> Result<Policy, String> {
    owned_alone(path, 0o022)?;
    let text = std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
    toml::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))
}

/// Missing, changed after approval, or not the operator's own: nothing is allowed.
pub fn load(source: &Source) -> Result<(Policy, &'static str), String> {
    if let Some(dir) = &source.host {
        return from_host(dir).map(|p| (p, "host-approval"));
    }
    match &source.answers {
        Some(path) => from_answers(path).map(|p| (p, "answers")),
        None => Err("the daemon was started without --host or --answers".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pmcp_plugin_support::approved::digest;

    #[test]
    fn an_approved_copy_loads_and_a_changed_one_does_not() {
        let dir = std::env::temp_dir().join(format!("pmcp-pty-policy-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).unwrap();
        }
        let manifest = "{\"sessions\": []}\n";
        let policy = "{\"version\": 1, \"mcp_write\": true, \"roots\": [\".\"], \"allow\": []}\n";
        std::fs::write(dir.join("host.json"), manifest).unwrap();
        std::fs::write(dir.join("policy.json"), policy).unwrap();
        let approval = format!("{{\"sha256\": \"{}\"}}", digest(manifest, policy));
        std::fs::write(dir.join("approval.json"), approval).unwrap();
        let source = Source {
            host: Some(dir.clone()),
            answers: None,
        };
        let (p, from) = load(&source).unwrap();
        assert!(p.mcp_write && from == "host-approval");
        std::fs::write(dir.join("policy.json"), policy.replace("[]", "[{}]")).unwrap();
        assert!(load(&source).unwrap_err().contains("does not match"));
        assert!(load(&Source::default()).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
