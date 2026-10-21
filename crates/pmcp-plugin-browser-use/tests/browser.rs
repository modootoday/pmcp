#![cfg(unix)]
// A real headless Chromium (the pinned build) against two local servers: one the policy
// approves, one it does not. No agent runtime and no network beyond 127.0.0.1.
use pmcp_plugin_browser_use::checks::chromium;
use pmcp_plugin_browser_use::proxy::{self, Blocked, Policy};
use pmcp_plugin_browser_use::session::Launch;
use pmcp_plugin_browser_use::tools::Browse;
use pmcp_plugin_support::mcp::{Out, Tools};
use serde_json::json;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::Arc;

const PAGE: &str = r#"<!doctype html><title>Form</title><h1>Hello</h1>
<label>Query <input id="q"></label>
<button onclick="document.getElementById('out').textContent='clicked '+document.getElementById('q').value">Go</button>
<p id="out"></p><a href="/leave">Leave</a>"#;
const LEAVE: &str = "<!doctype html><title>Leave</title><script>location.href='file:///etc/hostname'</script><p>leaving</p>";

// One-thread HTTP server: path -> body, everything else 404.
fn server(routes: Vec<(&'static str, &'static str)>) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    std::thread::spawn(move || {
        for mut conn in listener.incoming().flatten() {
            let mut buf = [0u8; 4096];
            let n = conn.read(&mut buf).unwrap_or(0);
            let head = String::from_utf8_lossy(&buf[..n]).to_string();
            let path = head.split_whitespace().nth(1).unwrap_or("/").to_string();
            let path = path
                .rsplit_once(&format!(":{port}"))
                .map_or(path.as_str(), |(_, p)| p)
                .to_string();
            let body = routes.iter().find(|(p, _)| *p == path).map(|(_, b)| *b);
            let (status, body) = body.map_or(("404 Not Found", "missing"), |b| ("200 OK", b));
            let reply = format!(
                "HTTP/1.1 {status}\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = conn.write_all(reply.as_bytes());
        }
    });
    port
}

async fn text(b: &Browse, name: &str, args: serde_json::Value) -> String {
    match b.call(name, args).await {
        Out::Text(t) | Out::Error(t) => t,
        Out::Image { note, .. } => note,
    }
}

fn chrome_with(profile: &std::path::Path) -> usize {
    let needle = profile.display().to_string();
    std::fs::read_dir("/proc")
        .unwrap()
        .flatten()
        .filter(|e| {
            std::fs::read(e.path().join("cmdline"))
                .is_ok_and(|c| String::from_utf8_lossy(&c).contains(&needle))
        })
        .count()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn browses_an_approved_site_blocks_the_rest_and_leaves_nothing_behind() {
    let site = server(vec![("/", PAGE), ("/leave", LEAVE)]);
    let secret = server(vec![("/", "<p>secret</p>")]);
    let root = std::env::temp_dir().join(format!("pmcp-browser-test-{}", std::process::id()));
    let policy = Arc::new(Policy::parse(&[format!("127.0.0.1:{site}")]).unwrap());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let proxy_port = listener.local_addr().unwrap().port();
    let blocked: Blocked = Default::default();
    tokio::spawn(proxy::serve(listener, policy, blocked.clone()));
    let launch = Launch {
        chromium: Some(chromium().expect("pinned Chromium (see pmcp-browser doctor)")),
        profile: root.join("profiles"),
        downloads: root.join("downloads"),
        proxy_port,
        display: None,
    };
    let b = Browse::new(launch, blocked);

    let opened = text(
        &b,
        "navigate",
        json!({ "url": format!("http://127.0.0.1:{site}/") }),
    )
    .await;
    assert!(opened.starts_with("Form\n"), "{opened}");
    let snap = text(&b, "snapshot", json!({})).await;
    assert!(snap.contains("heading \"Hello\""), "{snap}");
    let field = snap
        .lines()
        .find(|l| l.contains("textbox"))
        .and_then(|l| l.split("[ref=").nth(1))
        .unwrap()
        .trim_end_matches(']');
    let go = snap
        .lines()
        .find(|l| l.contains("button \"Go\""))
        .and_then(|l| l.split("[ref=").nth(1))
        .unwrap()
        .trim_end_matches(']');
    text(&b, "type", json!({ "ref": field, "text": "abc" })).await;
    text(&b, "click", json!({ "ref": go })).await;
    let read = text(&b, "read_text", json!({})).await;
    assert!(read.contains("clicked abc"), "{read}");

    let refused = text(
        &b,
        "navigate",
        json!({ "url": format!("http://127.0.0.1:{secret}/") }),
    )
    .await;
    assert!(
        refused.contains("blocked by the address policy")
            && refused.contains("not a public address"),
        "{refused}"
    );
    assert!(!text(&b, "read_text", json!({})).await.contains("secret"));
    let file = text(&b, "navigate", json!({ "url": "file:///etc/hostname" })).await;
    assert!(file.contains("only http and https"), "{file}");

    // A page that sends itself to file:// is stopped by the per-page block list.
    let host = std::fs::read_to_string("/etc/hostname").unwrap_or_default();
    text(
        &b,
        "navigate",
        json!({ "url": format!("http://127.0.0.1:{site}/leave") }),
    )
    .await;
    tokio::time::sleep(std::time::Duration::from_millis(800)).await;
    let after = text(&b, "read_text", json!({})).await;
    assert!(
        host.trim().is_empty() || !after.contains(host.trim()),
        "file:// content leaked: {after}"
    );

    let Out::Image { png, .. } = b.call("screenshot", json!({})).await else {
        panic!("no screenshot")
    };
    assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");

    let profiles = root.join("profiles");
    assert!(chrome_with(&profiles) > 0);
    text(&b, "close", json!({})).await;
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    assert_eq!(chrome_with(&profiles), 0, "Chromium outlived close");
    let left: Vec<_> = std::fs::read_dir(&profiles)
        .map(|d| d.flatten().collect())
        .unwrap_or_default();
    assert!(left.is_empty(), "a profile stayed behind");
    let _ = std::fs::remove_dir_all(&root);
}

// Chromium exits during close, and every call races that exit; close was raced too, so its
// reply could come before the profile was deleted, or end the cleanup before it began. Each
// round lost that race about half the time on a loaded host.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn close_replies_only_once_the_profile_is_gone() {
    let site = server(vec![("/", PAGE)]);
    let root = std::env::temp_dir().join(format!("pmcp-browser-close-{}", std::process::id()));
    let policy = Arc::new(Policy::parse(&[format!("127.0.0.1:{site}")]).unwrap());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let proxy_port = listener.local_addr().unwrap().port();
    let blocked: Blocked = Default::default();
    tokio::spawn(proxy::serve(listener, policy, blocked.clone()));
    let launch = Launch {
        chromium: Some(chromium().expect("pinned Chromium (see pmcp-browser doctor)")),
        profile: root.join("profiles"),
        downloads: root.join("downloads"),
        proxy_port,
        display: None,
    };
    let b = Browse::new(launch, blocked);
    let profiles = root.join("profiles");
    for round in 0..5 {
        let opened = text(
            &b,
            "navigate",
            json!({ "url": format!("http://127.0.0.1:{site}/") }),
        )
        .await;
        assert!(opened.starts_with("Form\n"), "round {round}: {opened}");
        let closed = text(&b, "close", json!({})).await;
        let left: Vec<_> = std::fs::read_dir(&profiles)
            .map(|d| d.flatten().map(|e| e.file_name()).collect())
            .unwrap_or_default();
        assert!(closed.starts_with("closed;"), "round {round}: {closed}");
        assert!(
            left.is_empty(),
            "round {round}: profile left at the reply: {left:?}"
        );
    }
    let _ = std::fs::remove_dir_all(&root);
}
