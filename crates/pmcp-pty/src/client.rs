use crate::proto::{AttachReq, Request};
use crate::transport::UnixStream;
use serde_json::Value;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;

pub fn connect(socket: &Path) -> Result<UnixStream, String> {
    UnixStream::connect(socket).map_err(|e| format!("connect {}: {e}", socket.display()))
}

/// One request, one reply, for library callers that hold typed requests.
pub fn request(socket: &Path, req: &Request) -> Result<Value, String> {
    let mut stream = connect(socket)?;
    let line = serde_json::to_string(req).map_err(|e| e.to_string())?;
    stream
        .write_all(format!("{line}\n").as_bytes())
        .map_err(|e| e.to_string())?;
    let mut reply = String::new();
    BufReader::new(stream)
        .read_line(&mut reply)
        .map_err(|e| e.to_string())?;
    serde_json::from_str(&reply).map_err(|e| format!("bad reply: {e}"))
}

// Read byte by byte: a buffered reader could swallow the first raw output after the reply line.
fn reply_line(stream: &mut UnixStream) -> Result<Value, String> {
    let mut line = Vec::new();
    let mut byte = [0u8; 1];
    loop {
        match stream.read(&mut byte) {
            Ok(0) => return Err("daemon closed the connection".into()),
            Ok(_) if byte[0] == b'\n' => break,
            Ok(_) => line.push(byte[0]),
            Err(e) => return Err(e.to_string()),
        }
    }
    serde_json::from_slice(&line).map_err(|e| format!("bad reply: {e}"))
}

/// An attached session as a plain byte stream: reads give the repaint and then raw output,
/// writes go to the PTY. A terminal, a TUI pane or a test can all drive it the same way.
pub fn attach_stream(socket: &Path, attach: AttachReq) -> Result<UnixStream, String> {
    let mut stream = connect(socket)?;
    let req = serde_json::to_string(&Request::Attach(attach)).map_err(|e| e.to_string())?;
    stream
        .write_all(format!("{req}\n").as_bytes())
        .map_err(|e| e.to_string())?;
    let reply = reply_line(&mut stream)?;
    if reply["ok"] != true {
        return Err(format!(
            "attach refused: {} {}",
            reply["code"], reply["message"]
        ));
    }
    Ok(stream)
}

/// Sends one request line and prints replies: one for plain requests, all of them for subscribe.
pub fn call(socket: &Path, request: &str) -> Result<(), String> {
    let parsed: Value =
        serde_json::from_str(request).map_err(|e| format!("request is not JSON: {e}"))?;
    let streaming = parsed["op"] == "subscribe";
    let mut stream = connect(socket)?;
    stream
        .write_all(format!("{parsed}\n").as_bytes())
        .map_err(|e| e.to_string())?;
    let reader = BufReader::new(stream);
    for line in reader.lines() {
        let line = line.map_err(|e| e.to_string())?;
        println!("{line}");
        if !streaming {
            break;
        }
    }
    Ok(())
}
