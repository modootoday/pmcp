#![cfg(unix)]
// launch reads only the operator-approved copy, never starts a browser, and its apps end with
// the desktop.
use pmcp_plugin_computer_use::display::Desktop;
use pmcp_plugin_computer_use::tools::Desk;
use pmcp_plugin_support::approved::digest;
use pmcp_plugin_support::mcp::Out;
use serde_json::json;
use std::os::unix::fs::PermissionsExt;
use std::time::{Duration, Instant};

fn approved(dir: &std::path::Path, policy: &str) {
    std::fs::create_dir_all(dir).unwrap();
    std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700)).unwrap();
    let manifest = "{\"version\": 1, \"sessions\": []}\n";
    std::fs::write(dir.join("host.json"), manifest).unwrap();
    std::fs::write(dir.join("policy.json"), policy).unwrap();
    let approval = format!("{{\"sha256\": \"{}\"}}", digest(manifest, policy));
    std::fs::write(dir.join("approval.json"), approval).unwrap();
}

fn alive(pid: u32) -> bool {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).unwrap_or_default();
    !stat.is_empty()
        && !stat
            .rsplit(')')
            .next()
            .unwrap_or("")
            .trim_start()
            .starts_with('Z')
}

#[test]
fn an_approved_app_starts_on_the_display_and_ends_with_it_and_browsers_never_start() {
    let root = std::env::temp_dir().join(format!("pmcp-desktop-launch-{}", std::process::id()));
    let dir = root.join("approval");
    let policy = json!({ "version": 1, "desktop": { "launch": [
        { "name": "sleeper", "argv": ["sleep", "30"] },
        { "name": "web", "argv": ["chromium"] }
    ] } });
    approved(&dir, &format!("{policy}\n"));
    let desktop = Desktop::start(&root.join("state"), 640, 480, 24).unwrap();
    let desk = Desk::new(desktop, Some(dir.clone())).unwrap();
    let Ok(Out::Text(text)) = desk.run("launch", &json!({ "app": "sleeper" })) else {
        panic!("sleeper did not launch")
    };
    let pid: u32 = text
        .split("(pid ")
        .nth(1)
        .unwrap()
        .split(')')
        .next()
        .unwrap()
        .parse()
        .unwrap();
    assert!(alive(pid));
    let env = std::fs::read_to_string(format!("/proc/{pid}/environ")).unwrap();
    assert!(env.contains("DISPLAY=:9") && env.contains("XAUTHORITY="));
    let web = desk.run("launch", &json!({ "app": "web" })).unwrap_err();
    assert!(
        web.contains("web is not approved; approved: sleeper"),
        "{web}"
    );
    // A copy changed after approval turns launch off again.
    std::fs::write(dir.join("policy.json"), "{\"desktop\": {\"launch\": []}}\n").unwrap();
    let changed = desk
        .run("launch", &json!({ "app": "sleeper" }))
        .unwrap_err();
    assert!(changed.contains("does not match its approval"), "{changed}");
    drop(desk);
    let start = Instant::now();
    while alive(pid) && start.elapsed() < Duration::from_secs(6) {
        std::thread::sleep(Duration::from_millis(50));
    }
    assert!(!alive(pid), "the launched app outlived the desktop");
    let _ = std::fs::remove_dir_all(&root);
}
