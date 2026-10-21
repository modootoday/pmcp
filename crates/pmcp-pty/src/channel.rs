use crate::error::{Code, Fail};
use crate::helper::{Helper, HelperSpec, log_path};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::Arc;

// How a hosted session was launched so its profile's delivery channel works: the TUI's own argv,
// plus a helper pmcp-pty starts beside it when the channel needs one.
#[derive(Clone, Debug, Default)]
pub struct Channel {
    pub kind: String,
    pub bin: String,
    pub remote: Option<String>,
    pub url: Option<String>,
    pub leader_socket: Option<String>,
    pub auth: Option<(String, String)>,
    pub helper: Option<Arc<Helper>>,
}

fn strings(a: &[&str]) -> Vec<String> {
    a.iter().map(|s| s.to_string()).collect()
}

fn free_port() -> Result<u16, Fail> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| Fail::new(Code::BadRequest, format!("no free port: {e}")))?;
    listener
        .local_addr()
        .map(|a| a.port())
        .map_err(|e| Fail::new(Code::BadRequest, e.to_string()))
}

fn session_dir(base: &Path) -> Result<PathBuf, Fail> {
    std::fs::create_dir_all(base)
        .map_err(|e| Fail::new(Code::BadRequest, format!("create {}: {e}", base.display())))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(base, std::fs::Permissions::from_mode(0o700));
    }
    Ok(base.to_path_buf())
}

/// The TUI's argv, the channel it sets up and the helper to start first, for the delivery kind.
pub fn prepare(
    delivery: &str,
    argv: Vec<String>,
    env: &[(String, String)],
    dir: &Path,
) -> Result<(Vec<String>, Channel, Option<HelperSpec>), Fail> {
    let bin = argv.first().cloned().unwrap_or_default();
    let mut channel = Channel {
        kind: delivery.into(),
        bin: bin.clone(),
        ..Channel::default()
    };
    let rest = argv[1.min(argv.len())..].to_vec();
    let helper = |helper: Vec<String>, socket: &str, dir: &Path| HelperSpec {
        argv: helper,
        socket: PathBuf::from(socket),
        log: log_path(dir),
    };
    match delivery {
        // The TUI attaches to a private app-server only it and the codex-queue driver use, so no
        // shared Codex daemon outlives or escapes the session.
        "codex-queue" => {
            let dir = session_dir(dir)?;
            let sock = dir.join("codex.sock").display().to_string();
            let remote = format!("unix://{sock}");
            channel.remote = Some(remote.clone());
            let server = vec![
                bin.clone(),
                "app-server".into(),
                "--listen".into(),
                remote.clone(),
            ];
            let mut tui = vec![bin, "--remote".into(), remote];
            tui.extend(rest);
            Ok((tui, channel, Some(helper(server, &sock, &dir))))
        }
        "http-prompt-async" => {
            let port = free_port()?;
            channel.url = Some(format!("http://127.0.0.1:{port}"));
            let get = |k: &str| env.iter().find(|(n, _)| n == k).map(|(_, v)| v.clone());
            let user = get("OPENCODE_SERVER_USERNAME").unwrap_or_else(|| "opencode".into());
            channel.auth = get("OPENCODE_SERVER_PASSWORD").map(|p| (user, p));
            let mut a = argv;
            a.extend(strings(&[
                "--port",
                &port.to_string(),
                "--hostname",
                "127.0.0.1",
            ]));
            Ok((a, channel, None))
        }
        // The session starts its own grok leader instead of letting the TUI spawn a detached one;
        // relay on demand keeps it off the grok.com relay until a headless client appears.
        "grok-leader-acp" => {
            let dir = session_dir(dir)?;
            let sock = dir.join("grok-leader.sock").display().to_string();
            channel.leader_socket = Some(sock.clone());
            let leader = vec![
                bin.clone(),
                "agent".into(),
                "leader".into(),
                "--leader-socket".into(),
                sock.clone(),
                "--relay-on-demand".into(),
            ];
            let mut tui = vec![
                bin,
                "--leader".into(),
                "--leader-socket".into(),
                sock.clone(),
            ];
            tui.extend(rest);
            Ok((tui, channel, Some(helper(leader, &sock, &dir))))
        }
        _ => Ok((argv, channel, None)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_channel_rewrites_the_launch_and_names_its_helper() {
        let dir = std::env::temp_dir().join(format!("pmcp-pty-channel-{}", std::process::id()));
        let sock = dir.join("codex.sock").display().to_string();
        let remote = format!("unix://{sock}");
        let (tui, c, h) =
            prepare("codex-queue", strings(&["codex", "-m", "x"]), &[], &dir).unwrap();
        assert_eq!(tui, strings(&["codex", "--remote", &remote, "-m", "x"]));
        assert_eq!(c.remote.as_deref(), Some(remote.as_str()));
        let h = h.unwrap();
        assert_eq!(
            h.argv,
            strings(&["codex", "app-server", "--listen", &remote])
        );
        assert_eq!(
            (h.socket.display().to_string(), h.log),
            (sock, dir.join("helper.log"))
        );
        let env = [("OPENCODE_SERVER_PASSWORD".to_string(), "pw".to_string())];
        let (oc, c, h) = prepare("http-prompt-async", strings(&["opencode"]), &env, &dir).unwrap();
        assert_eq!((oc[1].as_str(), h), ("--port", None));
        assert_eq!(c.url.unwrap(), format!("http://127.0.0.1:{}", oc[2]));
        assert_eq!(c.auth, Some(("opencode".into(), "pw".into())));
        let (tui, c, h) =
            prepare("grok-leader-acp", strings(&["grok", "-m", "x"]), &[], &dir).unwrap();
        let leader = c.leader_socket.unwrap();
        assert_eq!(
            tui,
            strings(&["grok", "--leader", "--leader-socket", &leader, "-m", "x"])
        );
        let want = strings(&[
            "grok",
            "agent",
            "leader",
            "--leader-socket",
            &leader,
            "--relay-on-demand",
        ]);
        assert_eq!(h.unwrap().argv, want);
        let (screen, _, h) = prepare("screen", strings(&["gemini"]), &[], &dir).unwrap();
        assert_eq!((screen, h), (strings(&["gemini"]), None));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
