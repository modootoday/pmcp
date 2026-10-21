use crate::clock::utc_iso;
use crate::delivery::{Ctx, Delivered, Delivery};
use crate::session::Session;
use crate::signals::Shared;
use serde_json::{Value, json};
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{Receiver, channel};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};

// A second ACP client on the private leader the grok TUI was launched with (measured:
// the TUI shows the prompt as its own turn). Permission requests are never answered, so any
// approval stays with the TUI. The client lives until the prompt ends so the turn is not cut.
pub struct GrokLeaderAcp;

// One deadline for the whole handshake: a prompt that has not started a turn by then falls
// back to the screen with the reason, instead of holding the caller's turn open.
const HANDSHAKE: Duration = Duration::from_secs(15);
const TURN_CAP: Duration = Duration::from_secs(1800);
const UNKNOWN_SESSION: i64 = -32602;
const LOG_CHARS: usize = 2000;

type Log = Arc<Mutex<Option<File>>>;

fn note(log: &Log, dir: &str, line: &str) {
    let mut file = log.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(f) = file.as_mut() {
        let cut: String = line.chars().take(LOG_CHARS).collect();
        let _ = writeln!(f, "{} {dir} {cut}", utc_iso(SystemTime::now()));
    }
}

struct Client {
    child: Child,
    stdin: ChildStdin,
    rx: Receiver<Value>,
    next: u64,
    log: Log,
    end: Instant,
    reply: String,
}

// The agent's own words for this turn, which the TUI may never draw.
fn chunk_text(v: &Value) -> Option<&str> {
    let update = &v["params"]["update"];
    if v["method"] != "session/update" || update["sessionUpdate"] != "agent_message_chunk" {
        return None;
    }
    update["content"]["text"].as_str()
}

impl Client {
    fn start(bin: &str, socket: &str, cwd: &str, log: Log) -> Result<Client, String> {
        let mut child = Command::new(bin)
            .args(["agent", "--leader", "--leader-socket", socket, "stdio"])
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("{bin} agent: {e}"))?;
        let stdin = child.stdin.take().ok_or("no stdin")?;
        let stdout = child.stdout.take().ok_or("no stdout")?;
        let (tx, rx) = channel();
        let reader_log = log.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                note(&reader_log, "<", &line);
                if let Ok(v) = serde_json::from_str::<Value>(&line) {
                    let _ = tx.send(v);
                }
            }
            note(&reader_log, "-", "client output closed");
        });
        let end = Instant::now() + HANDSHAKE;
        Ok(Client {
            child,
            stdin,
            rx,
            next: 1,
            log,
            end,
            reply: String::new(),
        })
    }

    fn send(&mut self, method: &str, params: Value) -> Result<u64, String> {
        let id = self.next;
        self.next += 1;
        let line = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        note(&self.log, ">", &line.to_string());
        writeln!(self.stdin, "{line}").map_err(|e| e.to_string())?;
        Ok(id)
    }

    // The reply to one request; with started, the first session update also counts.
    fn until(&mut self, id: u64, started: bool) -> Result<Value, String> {
        loop {
            let left = self.end.saturating_duration_since(Instant::now());
            let v = self.rx.recv_timeout(left).map_err(|_| {
                format!(
                    "no ACP reply to request {id} within {}s",
                    HANDSHAKE.as_secs()
                )
            })?;
            if let Some(text) = chunk_text(&v) {
                self.reply.push_str(text);
            }
            if v["id"] == id && v.get("method").is_none() {
                return Ok(v);
            }
            if started && v["method"] == "session/update" {
                return Ok(json!({ "started": true }));
            }
        }
    }
}

fn cwd_of(pid: Option<u32>) -> String {
    pid.and_then(|p| std::fs::read_link(format!("/proc/{p}/cwd")).ok())
        .map(|p| p.display().to_string())
        .unwrap_or_else(|| ".".into())
}

fn prompt(c: &mut Client, session: &str, text: &str, cwd: &str) -> Result<(u64, Value), String> {
    let params = json!({ "sessionId": session, "prompt": [{ "type": "text", "text": text }] });
    let id = c.send("session/prompt", params.clone())?;
    let first = c.until(id, true)?;
    if first["error"]["code"].as_i64() != Some(UNKNOWN_SESSION) {
        return match first.get("error") {
            Some(e) => Err(format!("session/prompt: {e}")),
            None => Ok((id, first)),
        };
    }
    let load = json!({ "sessionId": session, "cwd": cwd, "mcpServers": [] });
    let load = c.send("session/load", load)?;
    if let Some(e) = c.until(load, false)?.get("error") {
        return Err(format!("session/load: {e}"));
    }
    // A load replays history as agent chunks; only what the new prompt produces is its reply.
    c.reply.clear();
    let id = c.send("session/prompt", params)?;
    let first = c.until(id, true)?;
    match first.get("error") {
        Some(e) => Err(format!("session/prompt after load: {e}")),
        None => Ok((id, first)),
    }
}

// The prompt's own result ends the channel's view of the turn: its stop reason and reply.
fn finish(c: &Client, signals: &Shared, result: &Value) {
    let stop = result["result"]["stopReason"].as_str().map(String::from);
    let mut g = signals.lock().unwrap_or_else(|e| e.into_inner());
    g.channel_end(c.reply.trim().to_string(), stop);
}

// The exchange is kept beside the private leader socket, inside the session's own 0700 dir.
fn open_log(socket: &str) -> (Log, Option<PathBuf>) {
    let path = Path::new(socket).parent().map(|d| d.join("acp.log"));
    let file = path
        .as_ref()
        .and_then(|p| OpenOptions::new().create(true).append(true).open(p).ok());
    let shown = file.as_ref().and(path);
    (Arc::new(Mutex::new(file)), shown)
}

impl Delivery for GrokLeaderAcp {
    fn channel(&self) -> &'static str {
        "grok-leader-acp"
    }

    fn deliver(&self, s: &Session, text: &str, ctx: &Ctx) -> Result<Delivered, String> {
        let target = ctx.target.clone().unwrap_or_default();
        let channel = ctx.channel.clone().unwrap_or_default();
        let Some(socket) = channel.leader_socket.or(target.remote) else {
            return Ok(Delivered::Unavailable(
                "no private leader: launch with delivery_setup".into(),
            ));
        };
        let Some(session) = target.session else {
            return Ok(Delivered::Unavailable("no target session".into()));
        };
        let bin = if channel.bin.is_empty() {
            "grok".to_string()
        } else {
            channel.bin
        };
        let cwd = cwd_of(s.pid);
        let (log, log_path) = open_log(&socket);
        note(
            &log,
            "-",
            &format!("turn for session {session} via {socket}"),
        );
        let mut c = match Client::start(&bin, &socket, &cwd, log.clone()) {
            Ok(c) => c,
            Err(e) => return Ok(Delivered::Unavailable(e)),
        };
        let init = c.send(
            "initialize",
            json!({ "protocolVersion": 1, "clientCapabilities": {} }),
        );
        let sent = init
            .and_then(|id| c.until(id, false))
            .and_then(|_| prompt(&mut c, &session, text, &cwd));
        let (prompt_id, first) = match sent {
            Ok(found) => found,
            Err(e) => {
                note(&log, "-", &format!("gave up: {e}"));
                let _ = c.child.kill();
                let _ = c.child.wait();
                return Ok(Delivered::Unavailable(e));
            }
        };
        let signals = ctx.signals.clone();
        std::thread::spawn(move || {
            let end = Instant::now() + TURN_CAP;
            let mut done = first.get("result").map(|_| first.clone());
            while done.is_none() {
                let left = end.saturating_duration_since(Instant::now());
                let Ok(v) = c.rx.recv_timeout(left) else {
                    break;
                };
                if let Some(text) = chunk_text(&v) {
                    c.reply.push_str(text);
                }
                if v["id"] == prompt_id && v.get("method").is_none() {
                    done = Some(v);
                }
            }
            if let Some(result) = done {
                finish(&c, &signals, &result);
            }
            let _ = c.child.kill();
            let _ = c.child.wait();
        });
        let debug_log = log_path.map(|p| p.display().to_string());
        Ok(Delivered::Sent(json!({
            "ok": true, "accepted": true, "submitted": true, "leader_socket": socket,
            "session": session, "debug_log": debug_log,
        })))
    }
}
