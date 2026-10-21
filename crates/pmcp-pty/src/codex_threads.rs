use crate::transport::UnixStream;
use serde_json::{Value, json};
use std::io::{BufRead, BufReader, Read, Write};
use std::time::Duration;

// The private app-server speaks JSON-RPC over WebSocket on its unix socket, and the codex CLI
// has no client command for thread/loaded/list, so this is the smallest client that asks it.
pub const METHOD: &str = "thread/loaded/list";
const LIMIT: Duration = Duration::from_secs(5);

fn frame(text: &str) -> Vec<u8> {
    // Client frames must be masked; the mask needs no secrecy on a private unix socket.
    let mask = [0x37u8, 0xfa, 0x21, 0x3d];
    let body = text.as_bytes();
    let mut out = vec![0x81];
    match body.len() {
        n if n < 126 => out.push(0x80 | n as u8),
        n if n <= u16::MAX as usize => {
            out.push(0x80 | 126);
            out.extend((n as u16).to_be_bytes());
        }
        n => {
            out.push(0x80 | 127);
            out.extend((n as u64).to_be_bytes());
        }
    }
    out.extend(mask);
    out.extend(body.iter().enumerate().map(|(i, b)| b ^ mask[i % 4]));
    out
}

fn read_frame(r: &mut impl Read) -> Result<(u8, Vec<u8>), String> {
    let mut head = [0u8; 2];
    r.read_exact(&mut head).map_err(|e| e.to_string())?;
    let mut len = (head[1] & 0x7f) as u64;
    if len == 126 {
        let mut b = [0u8; 2];
        r.read_exact(&mut b).map_err(|e| e.to_string())?;
        len = u16::from_be_bytes(b) as u64;
    } else if len == 127 {
        let mut b = [0u8; 8];
        r.read_exact(&mut b).map_err(|e| e.to_string())?;
        len = u64::from_be_bytes(b);
    }
    if len > 4 << 20 {
        return Err(format!("frame of {len} bytes"));
    }
    let mut body = vec![0u8; len as usize];
    r.read_exact(&mut body).map_err(|e| e.to_string())?;
    Ok((head[0] & 0x0f, body))
}

fn upgrade(stream: &mut UnixStream, reader: &mut BufReader<UnixStream>) -> Result<(), String> {
    let request = "GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: cG1jcC1wdHktY29kZXgtcQ==\r\nSec-WebSocket-Version: 13\r\n\r\n";
    stream
        .write_all(request.as_bytes())
        .map_err(|e| e.to_string())?;
    let mut status = String::new();
    reader.read_line(&mut status).map_err(|e| e.to_string())?;
    if !status.contains(" 101 ") {
        return Err(format!("upgrade refused: {}", status.trim()));
    }
    let mut line = String::new();
    while reader.read_line(&mut line).map_err(|e| e.to_string())? > 0 && line != "\r\n" {
        line.clear();
    }
    Ok(())
}

fn call(
    stream: &mut UnixStream,
    reader: &mut BufReader<UnixStream>,
    id: u64,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    let msg = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
    stream
        .write_all(&frame(&msg.to_string()))
        .map_err(|e| e.to_string())?;
    loop {
        let (op, body) = read_frame(reader)?;
        if op == 0x8 {
            return Err("app-server closed the connection".into());
        }
        if op != 0x1 {
            continue;
        }
        let v: Value = serde_json::from_slice(&body).map_err(|e| e.to_string())?;
        if v["id"] != json!(id) {
            continue;
        }
        if let Some(err) = v.get("error") {
            return Err(format!("{method}: {err}"));
        }
        return Ok(v["result"].clone());
    }
}

// Ids in whichever shape the result takes: a list of ids, or of objects with id or threadId.
pub fn thread_ids(result: &Value) -> Vec<String> {
    let list = ["data", "threads", "threadIds", "thread_ids"]
        .iter()
        .find_map(|k| result.get(*k).and_then(Value::as_array))
        .or_else(|| result.as_array());
    let id_of = |v: &Value| match v {
        Value::String(s) => Some(s.clone()),
        _ => ["id", "threadId", "thread_id"]
            .iter()
            .find_map(|k| v[*k].as_str().map(String::from)),
    };
    list.map(|l| l.iter().filter_map(id_of).collect())
        .unwrap_or_default()
}

/// The threads loaded on the app-server at this unix socket.
pub fn loaded(socket: &str) -> Result<Vec<String>, String> {
    let mut stream = UnixStream::connect(socket).map_err(|e| format!("{socket}: {e}"))?;
    stream
        .set_read_timeout(Some(LIMIT))
        .map_err(|e| e.to_string())?;
    let mut reader = BufReader::new(stream.try_clone().map_err(|e| e.to_string())?);
    upgrade(&mut stream, &mut reader)?;
    let info =
        json!({ "clientInfo": { "name": "pmcp-pty", "version": env!("CARGO_PKG_VERSION") } });
    call(&mut stream, &mut reader, 1, "initialize", info)?;
    let note = json!({ "jsonrpc": "2.0", "method": "initialized" });
    stream
        .write_all(&frame(&note.to_string()))
        .map_err(|e| e.to_string())?;
    let result = call(&mut stream, &mut reader, 2, METHOD, json!({}))?;
    Ok(thread_ids(&result))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_come_from_any_plausible_result_shape_and_frames_are_masked() {
        assert_eq!(thread_ids(&json!({ "data": ["t1"] })), ["t1"]);
        assert_eq!(thread_ids(&json!({ "threads": [{ "id": "t2" }] })), ["t2"]);
        assert_eq!(thread_ids(&json!([{ "threadId": "t3" }])), ["t3"]);
        assert!(thread_ids(&json!({})).is_empty());
        let f = frame("hi");
        assert_eq!((f[0], f[1]), (0x81, 0x82));
        assert_eq!(f[6] ^ f[2], b'h');
    }
}
