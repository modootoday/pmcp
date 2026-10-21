use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

// doctor reads and reports; setup --plan prints; only setup --apply changes anything, and only
// at user level. Root steps are printed for the operator, never run.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Status {
    Ok,
    Missing,
    Unsupported,
}

#[derive(Debug, Clone)]
pub struct Check {
    pub name: &'static str,
    pub status: Status,
    pub found: String,
    // The exact command that fixes it, and whether it needs root.
    pub fix: Option<(String, bool)>,
}

pub fn on_path(program: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(program))
        .find(|p| p.is_file())
}

pub fn runs(program: &str, args: &[&str]) -> Option<String> {
    let out = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// ID and VERSION_ID from /etc/os-release, for the package names in fixes.
pub fn platform(os_release: &Path) -> (String, String) {
    let text = std::fs::read_to_string(os_release).unwrap_or_default();
    let get = |key: &str| {
        text.lines()
            .find_map(|l| l.strip_prefix(&format!("{key}=")))
            .map(|v| v.trim_matches('"').to_string())
            .unwrap_or_default()
    };
    (get("ID"), get("VERSION_ID"))
}

pub fn supported(id: &str, version: &str) -> bool {
    matches!(
        (id, version),
        ("ubuntu", "22.04") | ("ubuntu", "24.04") | ("debian", "12") | ("debian", "13")
    )
}

/// The plugins' first doctor row: the Linux distributions their fixes name, and a plain reason
/// on macOS and Windows, where they do not run yet.
pub fn platform_row() -> Check {
    if let Some(found) = crate::platform::plugins_unsupported() {
        return Check {
            name: "platform",
            status: Status::Unsupported,
            found,
            fix: None,
        };
    }
    let (id, version) = platform(Path::new("/etc/os-release"));
    Check {
        name: "platform",
        status: if supported(&id, &version) {
            Status::Ok
        } else {
            Status::Unsupported
        },
        found: format!("{id} {version}"),
        fix: None,
    }
}

pub fn render(checks: &[Check]) -> String {
    let mut out = String::new();
    for c in checks {
        let status = match c.status {
            Status::Ok => "OK",
            Status::Missing => "MISSING",
            Status::Unsupported => "UNSUPPORTED",
        };
        out.push_str(&format!("{status:<11} {:<14} {}\n", c.name, c.found));
        if let Some((fix, root)) = &c.fix {
            let who = if *root {
                "operator runs"
            } else {
                "setup --apply runs"
            };
            out.push_str(&format!("            fix ({who}): {fix}\n"));
        }
    }
    out
}

/// 0 ready, 1 something missing, 2 unsupported platform.
pub fn exit_code(checks: &[Check]) -> i32 {
    match () {
        _ if checks.iter().any(|c| c.status == Status::Unsupported) => 2,
        _ if checks.iter().any(|c| c.status == Status::Missing) => 1,
        _ => 0,
    }
}

/// setup --plan: the root steps for the operator and the user steps setup --apply would take.
pub fn plan(checks: &[Check]) -> String {
    let fixes = |root: bool| -> Vec<String> {
        checks
            .iter()
            .filter_map(|c| c.fix.clone())
            .filter(|(_, r)| *r == root)
            .map(|(f, _)| f)
            .collect()
    };
    let (root, user) = (fixes(true), fixes(false));
    let mut out = String::new();
    out.push_str("operator runs (root):\n");
    out.push_str(&if root.is_empty() {
        "  nothing\n".into()
    } else {
        root.iter().map(|f| format!("  {f}\n")).collect::<String>()
    });
    out.push_str("setup --apply runs (user):\n");
    out.push_str(&if user.is_empty() {
        "  nothing\n".into()
    } else {
        user.iter().map(|f| format!("  {f}\n")).collect::<String>()
    });
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_checks_print_their_fix_and_the_plan_splits_root_from_user() {
        let checks = vec![
            Check {
                name: "Xvfb",
                status: Status::Ok,
                found: "/usr/bin/Xvfb".into(),
                fix: None,
            },
            Check {
                name: "CJK font",
                status: Status::Missing,
                found: "none".into(),
                fix: Some(("sudo apt-get install -y fonts-noto-cjk".into(), true)),
            },
        ];
        assert_eq!(exit_code(&checks), 1);
        assert!(
            render(&checks).contains("fix (operator runs): sudo apt-get install -y fonts-noto-cjk")
        );
        let p = plan(&checks);
        assert!(
            p.contains("operator runs (root):\n  sudo apt-get")
                && p.ends_with("(user):\n  nothing\n")
        );
        assert!(supported("ubuntu", "22.04") && !supported("arch", ""));
    }
}
