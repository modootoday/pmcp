use crate::codex_threads;
use crate::delivery::{Ctx, Delivered, Delivery};
use crate::session::Session;
use serde_json::json;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const LIMIT: Duration = Duration::from_secs(20);

// codex queue adds a message to a thread on an app-server. pmcp-pty uses it only for a session
// it launched with a private app-server (delivery_setup) or an explicit remote from the caller,
// never the shared daemon by default, because work there escapes the session's scope.
pub struct CodexQueue;

fn run(bin: &str, args: &[String]) -> Result<(i32, String, String), String> {
    let mut child = Command::new(bin)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("{bin}: {e}"))?;
    let start = Instant::now();
    while child.try_wait().map_err(|e| e.to_string())?.is_none() {
        if start.elapsed() > LIMIT {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!(
                "{bin} queue did not finish in {}s",
                LIMIT.as_secs()
            ));
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    let text = |b: &[u8]| {
        String::from_utf8_lossy(b)
            .trim()
            .chars()
            .take(400)
            .collect::<String>()
    };
    Ok((
        out.status.code().unwrap_or(-1),
        text(&out.stdout),
        text(&out.stderr),
    ))
}

fn only_thread(remote: &str) -> Result<String, String> {
    let socket = remote
        .strip_prefix("unix://")
        .ok_or("the app-server is not on a unix socket")?;
    let ids =
        codex_threads::loaded(socket).map_err(|e| format!("{}: {e}", codex_threads::METHOD))?;
    match ids.as_slice() {
        [one] => Ok(one.clone()),
        _ => Err(format!(
            "{} on the private app-server returned {} threads",
            codex_threads::METHOD,
            ids.len()
        )),
    }
}

impl Delivery for CodexQueue {
    fn channel(&self) -> &'static str {
        "codex-queue"
    }

    fn deliver(&self, _s: &Session, text: &str, ctx: &Ctx) -> Result<Delivered, String> {
        let target = ctx.target.clone().unwrap_or_default();
        let channel = ctx.channel.clone().unwrap_or_default();
        let private = target.remote.is_none();
        let Some(remote) = target.remote.or(channel.remote) else {
            return Ok(Delivered::Unavailable(
                "no private app-server: launch with delivery_setup".into(),
            ));
        };
        let mut source = "target";
        let thread = match target.session {
            Some(t) => t,
            // Only the session's own app-server serves this TUI alone, so one loaded thread is it.
            None if private => match only_thread(&remote) {
                Ok(t) => {
                    source = codex_threads::METHOD;
                    t
                }
                Err(why) => return Ok(Delivered::Unavailable(format!("no target session; {why}"))),
            },
            None => return Ok(Delivered::Unavailable("no target session".into())),
        };
        let bin = match channel.bin.is_empty() {
            true => "codex".to_string(),
            false => channel.bin,
        };
        let args: Vec<String> = [
            "queue",
            "--remote",
            &remote,
            "--thread",
            &thread,
            "--message",
            text,
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        match run(&bin, &args) {
            Ok((0, stdout, _)) => Ok(Delivered::Sent(json!({
                "ok": true, "accepted": true, "submitted": true, "remote": remote, "thread": thread, "thread_from": source, "output": stdout,
            }))),
            Ok((code, _, stderr)) => Ok(Delivered::Unavailable(format!(
                "codex queue exited {code}: {stderr}"
            ))),
            Err(e) => Ok(Delivered::Unavailable(e)),
        }
    }
}
