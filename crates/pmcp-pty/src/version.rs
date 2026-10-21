use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

// gemini --version takes over 3 s on an idle host and longer while the session itself starts.
const LIMIT: Duration = Duration::from_secs(20);

// A profile's patterns were read from one runtime version; asking the runtime at spawn lets
// observe warn when the installed one differs, before a changed dialog string bites.
pub fn detect(argv0: &str, cwd: Option<&str>) -> Option<String> {
    let mut cmd = Command::new(argv0);
    cmd.arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    let mut child = cmd.spawn().ok()?;
    let start = Instant::now();
    loop {
        if child.try_wait().ok()?.is_some() {
            break;
        }
        if start.elapsed() > LIMIT {
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    let output = child.wait_with_output().ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    text.lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .map(String::from)
}

/// A warning when the detected version is not the one the profile was read from.
pub fn drift(profile_version: Option<&str>, detected: Option<&str>) -> Option<String> {
    let want = profile_version?;
    match detected {
        Some(got) if got == want => None,
        Some(got) => Some(format!("profile read from {want}, running {got}")),
        None => Some(format!("profile read from {want}, running version unknown")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drift_is_reported_only_against_a_profile_version() {
        assert_eq!(drift(None, Some("x 1")), None);
        assert_eq!(drift(Some("x 1"), Some("x 1")), None);
        assert_eq!(
            drift(Some("x 1"), Some("x 2")).unwrap(),
            "profile read from x 1, running x 2"
        );
        assert!(drift(Some("x 1"), None).unwrap().contains("unknown"));
    }

    #[test]
    fn detects_the_first_line_of_version_output() {
        let python = detect("python3", None).unwrap();
        assert!(python.starts_with("Python 3."), "{python}");
        assert_eq!(detect("/nonexistent/runtime", None), None);
    }
}
