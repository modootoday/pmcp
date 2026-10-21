use pmcp_plugin_support::doctor::{Check, Status, on_path, platform_row, runs};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Path, PathBuf};

// The pinned Chromium: the Playwright build chromium-1243, "Google Chrome for Testing
// 153.0.8010.12" (chromium-1243). A different binary is refused rather than trusted.
pub const PIN_REVISION: &str = "1243";
pub const PIN_SHA256: &str = "8c599d43aec53f2460a31ae2f4af6bd863f8258b34ff519564bc5d4726bfaa1e";

/// The managed policy headed mode needs; its content is in the repo so its hash can be shown.
pub const MANAGED_POLICY: &str = include_str!("../policy/pmcp-browser.json");
pub const POLICY_DIRS: &[&str] = &[
    "/etc/opt/chrome_for_testing/policies/managed",
    "/etc/opt/chrome/policies/managed",
    "/etc/chromium/policies/managed",
];

pub fn sha256_file(path: &Path) -> Option<String> {
    let mut file = std::fs::File::open(path).ok()?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = file.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Some(
        hasher
            .finalize()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect(),
    )
}

pub fn sha256_text(text: &str) -> String {
    Sha256::digest(text.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn home() -> PathBuf {
    PathBuf::from(std::env::var_os("HOME").unwrap_or_default())
}

fn xdg(var: &str, fallback: &str) -> PathBuf {
    std::env::var_os(var)
        .map(PathBuf::from)
        .unwrap_or_else(|| home().join(fallback))
}

/// Where setup --apply puts the adopted build, and where serve looks first.
pub fn adopted() -> PathBuf {
    xdg("XDG_CACHE_HOME", ".cache")
        .join("pmcp-plugins/chromium")
        .join(PIN_REVISION)
        .join("chrome")
}

pub fn playwright_build() -> PathBuf {
    home().join(format!(
        ".cache/ms-playwright/chromium-{PIN_REVISION}/chrome-linux64/chrome"
    ))
}

/// The pinned binary to run: the adopted one, else the Playwright copy, if its hash matches.
pub fn chromium() -> Result<PathBuf, String> {
    for path in [adopted(), playwright_build()] {
        if path.exists() && sha256_file(&path).as_deref() == Some(PIN_SHA256) {
            return Ok(path);
        }
    }
    Err("no pinned Chromium; see pmcp-browser doctor".into())
}

/// chromium(), hashed once per process at the first launch rather than before MCP initialize:
/// hashing 290 MB first delayed the server's answer past what a client waits at startup.
/// The verdict is not kept on disk, where a same-user process could forge it.
pub fn chromium_once() -> Result<PathBuf, String> {
    static FOUND: std::sync::OnceLock<Result<PathBuf, String>> = std::sync::OnceLock::new();
    FOUND.get_or_init(chromium).clone()
}

pub fn managed_policy_installed() -> Option<PathBuf> {
    POLICY_DIRS
        .iter()
        .map(|d| Path::new(d).join("pmcp-browser.json"))
        .find(|p| std::fs::read_to_string(p).is_ok_and(|t| t == MANAGED_POLICY))
}

fn check(
    name: &'static str,
    ok: Option<String>,
    missing: &str,
    fix: Option<(String, bool)>,
) -> Check {
    match ok {
        Some(found) => Check {
            name,
            status: Status::Ok,
            found,
            fix: None,
        },
        None => Check {
            name,
            status: Status::Missing,
            found: missing.into(),
            fix,
        },
    }
}

pub fn checks() -> Vec<Check> {
    let mut out = vec![platform_row()];
    let pinned = chromium()
        .ok()
        .map(|p| format!("{} (sha256 matches the pin)", p.display()));
    let adopt = Some((
        "pmcp-browser setup --apply   (adopts the matching Playwright build as a symlink)".into(),
        false,
    ));
    let download = Some((
        format!(
            "npx playwright install chromium   (revision {PIN_REVISION}; a download, needs approval)"
        ),
        false,
    ));
    let fix = if playwright_build().exists() {
        adopt
    } else {
        download
    };
    out.push(check(
        "chromium",
        pinned,
        &format!("no build with sha256 {}…", &PIN_SHA256[..12]),
        fix,
    ));
    let userns = std::fs::read_to_string("/proc/sys/kernel/unprivileged_userns_clone")
        .map(|s| s.trim() == "1")
        .unwrap_or(true);
    let apparmor =
        std::fs::read_to_string("/proc/sys/kernel/apparmor_restrict_unprivileged_userns")
            .map(|s| s.trim() == "0")
            .unwrap_or(true);
    let sandbox = (userns && apparmor).then(|| "user namespaces allowed".to_string());
    let sysctl = Some(("sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0   (or an AppArmor profile for this Chromium)".into(), true));
    out.push(check(
        "sandbox",
        sandbox,
        "Chromium's sandbox cannot start; pmcp-browser never adds --no-sandbox",
        sysctl,
    ));
    let systemd = runs("systemd-run", &["--version"])
        .map(|v| v.lines().next().unwrap_or_default().to_string());
    out.push(check(
        "systemd-run",
        systemd,
        "no user systemd (serve --no-scope runs without memory caps)",
        None,
    ));
    let cjk = runs("fc-list", &[":lang=ko", "family"])
        .filter(|s| !s.is_empty())
        .map(|f| f.lines().next().unwrap_or_default().to_string());
    out.push(check(
        "CJK font",
        cjk,
        "none",
        Some((
            "sudo apt-get install -y --no-install-recommends fonts-noto-cjk".into(),
            true,
        )),
    ));
    let policy =
        managed_policy_installed().map(|p| format!("{} (headed mode allowed)", p.display()));
    let install = format!(
        "sudo install -D -m 0644 <repo>/crates/pmcp-plugin-browser-use/policy/pmcp-browser.json {}/pmcp-browser.json   (sha256 {})",
        POLICY_DIRS[0],
        sha256_text(MANAGED_POLICY)
    );
    let mut headed = check(
        "headed policy",
        policy,
        "absent: headless only; headed on a desktop is refused",
        Some((install, true)),
    );
    headed.status = Status::Ok;
    out.push(headed);
    // Headed mode is optional, so neither its policy nor Xvfb makes doctor fail.
    let xvfb = on_path("Xvfb").map(|p| p.display().to_string());
    let mut display = check(
        "Xvfb",
        xvfb,
        "absent (headed mode needs pmcp-desktop's display)",
        None,
    );
    display.status = Status::Ok;
    out.push(display);
    out
}
