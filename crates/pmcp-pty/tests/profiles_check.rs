#![cfg(unix)]
use std::path::PathBuf;
use std::process::Command;

// Synthetic screens (fixtures/<runtime>/<label>, each meta.json names the capture or strings it
// mirrors) replayed against the built-in profiles: a profile change that misreads one fails here.
#[test]
fn fixture_screens_still_read_the_same() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let out = Command::new(env!("CARGO_BIN_EXE_pmcp-pty"))
        .args(["profiles", "--check"])
        .arg(root.join("fixtures"))
        .output()
        .unwrap();
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        out.status.success(),
        "{stdout}{}",
        String::from_utf8_lossy(&out.stderr)
    );
    for runtime in ["agy", "claude", "codex", "gemini", "grok", "opencode"] {
        assert!(
            stdout.contains(&format!("ok {runtime}/")),
            "{runtime} has no fixture: {stdout}"
        );
    }
}
