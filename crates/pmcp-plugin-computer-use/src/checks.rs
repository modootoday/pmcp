use pmcp_plugin_support::doctor::{Check, Status, on_path, platform_row, runs};

// What pmcp-desktop needs on this host. Everything here is a root package, so setup --apply
// has nothing of its own to do and prints the operator's steps.
pub fn checks() -> Vec<Check> {
    let mut out = vec![platform_row()];
    let apt = |pkg: &str| {
        Some((
            format!("sudo apt-get install -y --no-install-recommends {pkg}"),
            true,
        ))
    };
    out.push(match on_path("Xvfb") {
        Some(p) => Check {
            name: "Xvfb",
            status: Status::Ok,
            found: p.display().to_string(),
            fix: None,
        },
        None => Check {
            name: "Xvfb",
            status: Status::Missing,
            found: "not on PATH".into(),
            fix: apt("xvfb"),
        },
    });
    out.push(match runs("systemd-run", &["--version"]) {
        Some(v) => Check {
            name: "systemd-run",
            status: Status::Ok,
            found: v.lines().next().unwrap_or_default().to_string(),
            fix: None,
        },
        None => Check {
            name: "systemd-run",
            status: Status::Missing,
            found: "no user systemd (serve --no-scope runs without memory caps)".into(),
            fix: None,
        },
    });
    // Korean and other CJK text renders as boxes in screenshots without a CJK font.
    let cjk = runs("fc-list", &[":lang=ko", "family"]).filter(|s| !s.is_empty());
    out.push(match cjk {
        Some(f) => Check {
            name: "CJK font",
            status: Status::Ok,
            found: f.lines().next().unwrap_or_default().to_string(),
            fix: None,
        },
        None => Check {
            name: "CJK font",
            status: Status::Missing,
            found: "none".into(),
            fix: apt("fonts-noto-cjk"),
        },
    });
    out.push(match crate::display::free_display() {
        Some(n) => Check {
            name: "display",
            status: Status::Ok,
            found: format!(":{n} is free"),
            fix: None,
        },
        None => Check {
            name: "display",
            status: Status::Missing,
            found: ":90 to :99 are all taken".into(),
            fix: Some((
                "stop a stale Xvfb or remove its /tmp/.X<n>-lock".into(),
                false,
            )),
        },
    });
    out
}
