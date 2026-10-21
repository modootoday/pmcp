use std::path::Path;

// Chromium's processes seen from /proc: a killed browser leaves renderers and helpers that no
// longer have a parent to stop them, and its own exit is what a pending call has to notice.

/// Every process running on this profile: an argument is --user-data-dir=<profile> or names a
/// path inside it, as helpers such as the crash handler are given --database=<profile>/...
pub fn on_profile(profile: &Path) -> Vec<u32> {
    let arg = format!("--user-data-dir={}", profile.display());
    let inside = format!("{}/", profile.display());
    let Ok(dir) = std::fs::read_dir("/proc") else {
        return Vec::new();
    };
    dir.flatten()
        .filter_map(|e| e.file_name().to_string_lossy().parse::<u32>().ok())
        .filter(|pid| {
            let cmd = std::fs::read(format!("/proc/{pid}/cmdline")).unwrap_or_default();
            cmd.split(|b| *b == 0).any(|a| {
                a == arg.as_bytes() || String::from_utf8_lossy(a).contains(inside.as_str())
            })
        })
        .collect()
}

/// HUP, then KILL, to whatever still runs on the profile.
pub fn sweep(profile: &Path) {
    let left = on_profile(profile);
    if !left.is_empty() {
        pmcp_plugin_support::reap::terminate(&left, pmcp_plugin_support::reap::GRACE);
    }
}

/// Resolves when the process has exited or is a zombie, polling /proc.
pub async fn gone(pid: u32) {
    loop {
        let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).unwrap_or_default();
        let state = stat
            .rsplit(')')
            .next()
            .unwrap_or("")
            .trim_start()
            .chars()
            .next();
        if stat.is_empty() || state == Some('Z') {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
}
