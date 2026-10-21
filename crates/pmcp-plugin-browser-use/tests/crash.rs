#![cfg(unix)]
// Live run 1: after kill -9 of Chromium, read_text hung 60 s with an earlier call's refusal in
// its reply, and the next navigate timed out. A real Chromium is killed here mid-session.
use pmcp_plugin_browser_use::checks::chromium;
use pmcp_plugin_browser_use::proxy::{self, Blocked, Policy};
use pmcp_plugin_browser_use::session::Launch;
use pmcp_plugin_browser_use::tools::Browse;
use pmcp_plugin_support::mcp::{Out, Tools};
use serde_json::json;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::Arc;
use std::time::{Duration, Instant};

fn server(body: &'static str) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    std::thread::spawn(move || {
        for mut conn in listener.incoming().flatten() {
            let mut buf = [0u8; 4096];
            let _ = conn.read(&mut buf);
            let reply = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = conn.write_all(reply.as_bytes());
        }
    });
    port
}

// The browser processes on this test's profiles: (pid, is it the main browser process).
fn chromes(profiles: &std::path::Path) -> Vec<(u32, bool)> {
    let needle = profiles.display().to_string();
    std::fs::read_dir("/proc")
        .unwrap()
        .flatten()
        .filter_map(|e| {
            let pid: u32 = e.file_name().to_string_lossy().parse().ok()?;
            let cmd =
                String::from_utf8_lossy(&std::fs::read(e.path().join("cmdline")).ok()?).to_string();
            let stat = std::fs::read_to_string(e.path().join("stat")).ok()?;
            let zombie = stat.rsplit(')').next()?.trim_start().starts_with('Z');
            (cmd.contains(&needle) && !zombie).then_some((pid, !cmd.contains("--type=")))
        })
        .collect()
}

fn reply(out: Out) -> (bool, String) {
    match out {
        Out::Text(t) => (false, t),
        Out::Error(t) => (true, t),
        Out::Image { note, .. } => (false, note),
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_killed_chromium_is_reported_at_once_and_the_next_call_starts_fresh() {
    let site = server("<title>Up</title><p>alive</p>");
    let other = server("<p>other</p>");
    let root = std::env::temp_dir().join(format!("pmcp-browser-crash-{}", std::process::id()));
    let policy = Arc::new(Policy::parse(&[format!("127.0.0.1:{site}")]).unwrap());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let proxy_port = listener.local_addr().unwrap().port();
    let blocked: Blocked = Default::default();
    tokio::spawn(proxy::serve(listener, policy, blocked.clone()));
    let profiles = root.join("profiles");
    let launch = Launch {
        chromium: Some(chromium().expect("pinned Chromium")),
        profile: profiles.clone(),
        downloads: root.join("downloads"),
        proxy_port,
        display: None,
    };
    let b = Browse::new(launch, blocked);
    let url = format!("http://127.0.0.1:{site}/");

    let (_, refused) = reply(
        b.call(
            "navigate",
            json!({ "url": format!("http://127.0.0.1:{other}/") }),
        )
        .await,
    );
    assert!(
        refused.contains("blocked by the address policy"),
        "{refused}"
    );
    let (_, next) = reply(b.call("navigate", json!({ "url": url })).await);
    assert!(
        !next.contains("blocked"),
        "an earlier refusal leaked into this reply: {next}"
    );

    let main: Vec<u32> = chromes(&profiles)
        .into_iter()
        .filter(|(_, m)| *m)
        .map(|(p, _)| p)
        .collect();
    assert_eq!(main.len(), 1, "{main:?}");
    unsafe { libc::kill(main[0] as i32, libc::SIGKILL) };
    let start = Instant::now();
    let (error, text) = reply(b.call("read_text", json!({})).await);
    assert!(error && text.contains("Chromium went away"), "{text}");
    assert!(
        start.elapsed() < Duration::from_secs(5),
        "took {:?}",
        start.elapsed()
    );
    assert!(!text.contains("blocked"), "{text}");
    // Helpers of the dead browser are swept, though one may still be exiting for a moment.
    let swept = Instant::now();
    let mut left = chromes(&profiles);
    while !left.is_empty() && swept.elapsed() < Duration::from_secs(3) {
        tokio::time::sleep(Duration::from_millis(100)).await;
        left = chromes(&profiles);
    }
    assert!(
        left.is_empty(),
        "the dead browser's processes stayed: {left:?}"
    );

    let (error, text) = reply(b.call("navigate", json!({ "url": url })).await);
    assert!(!error && text.starts_with("Up"), "{text}");
    assert!(!chromes(&profiles).iter().any(|(p, _)| *p == main[0]));
    b.call("close", json!({})).await;
    assert!(chromes(&profiles).is_empty());
    let left: Vec<_> = std::fs::read_dir(&profiles)
        .map(|d| d.flatten().collect())
        .unwrap_or_default();
    assert!(left.is_empty(), "a profile stayed behind");
    let _ = std::fs::remove_dir_all(&root);
}

// The other order: the socket breaks before the pid watcher looks, and the call failed with
// the connection's own error ("oneshot canceled") instead of saying the browser went away.
// It is a race, so several rounds of kill-then-call give it room to happen.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_call_on_a_just_killed_chromium_says_it_went_away_whichever_sees_it_first() {
    let site = server("<title>Up</title><p>alive</p>");
    let root = std::env::temp_dir().join(format!("pmcp-browser-race-{}", std::process::id()));
    let policy = Arc::new(Policy::parse(&[format!("127.0.0.1:{site}")]).unwrap());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let proxy_port = listener.local_addr().unwrap().port();
    let blocked: Blocked = Default::default();
    tokio::spawn(proxy::serve(listener, policy, blocked.clone()));
    let profiles = root.join("profiles");
    let launch = Launch {
        chromium: Some(chromium().expect("pinned Chromium")),
        profile: profiles.clone(),
        downloads: root.join("downloads"),
        proxy_port,
        display: None,
    };
    let b = Browse::new(launch, blocked);
    let url = format!("http://127.0.0.1:{site}/");
    for round in 0..8 {
        let (error, text) = reply(b.call("navigate", json!({ "url": url })).await);
        assert!(!error && text.starts_with("Up"), "round {round}: {text}");
        let main: Vec<u32> = chromes(&profiles)
            .into_iter()
            .filter(|(_, m)| *m)
            .map(|(p, _)| p)
            .collect();
        assert_eq!(main.len(), 1, "round {round}: {main:?}");
        unsafe { libc::kill(main[0] as i32, libc::SIGKILL) };
        let (error, text) = reply(b.call("read_text", json!({})).await);
        assert!(
            error && text.contains("Chromium went away"),
            "round {round}: {text}"
        );
    }
    b.call("close", json!({})).await;
    let _ = std::fs::remove_dir_all(&root);
}
