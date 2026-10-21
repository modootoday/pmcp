use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

// A minimal HTTP/1.1 client for a runtime server on loopback; no TLS, no redirects, one request
// per connection. Enough for opencode's own server, which pmcp-pty launched on a known port.
const B64: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

pub fn base64(input: &[u8]) -> String {
    let mut out = String::new();
    for chunk in input.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        for i in 0..4 {
            match i <= chunk.len() {
                true => out.push(B64[(n >> (18 - 6 * i) & 63) as usize] as char),
                false => out.push('='),
            }
        }
    }
    out
}

fn host_port(url: &str) -> Result<&str, String> {
    let rest = url
        .strip_prefix("http://")
        .ok_or(format!("not an http URL: {url}"))?;
    let host = rest.split('/').next().unwrap_or(rest);
    match host.starts_with("127.0.0.1:") || host.starts_with("localhost:") {
        true => Ok(host),
        false => Err(format!("only loopback servers are reached: {url}")),
    }
}

fn dechunk(body: &str) -> String {
    let mut out = String::new();
    let mut rest = body;
    while let Some((size, tail)) = rest.split_once("\r\n") {
        let Ok(n) = usize::from_str_radix(size.trim(), 16) else {
            return body.to_string();
        };
        if n == 0 || tail.len() < n {
            break;
        }
        out.push_str(&tail[..n]);
        rest = tail[n..].trim_start_matches("\r\n");
    }
    out
}

pub fn request(
    url: &str,
    method: &str,
    path: &str,
    body: Option<&str>,
    auth: Option<&(String, String)>,
) -> Result<(u16, String), String> {
    let host = host_port(url)?;
    let addr = host.replace("localhost", "127.0.0.1");
    let sock = addr.parse().map_err(|e| format!("{addr}: {e}"))?;
    let mut stream = TcpStream::connect_timeout(&sock, Duration::from_secs(3))
        .map_err(|e| format!("connect {host}: {e}"))?;
    let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
    let mut head = format!("{method} {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n");
    if let Some((user, password)) = auth {
        head.push_str(&format!(
            "Authorization: Basic {}\r\n",
            base64(format!("{user}:{password}").as_bytes())
        ));
    }
    let payload = body.unwrap_or("");
    head.push_str(&format!(
        "Content-Type: application/json\r\nContent-Length: {}\r\n\r\n",
        payload.len()
    ));
    stream
        .write_all(format!("{head}{payload}").as_bytes())
        .map_err(|e| e.to_string())?;
    let mut raw = String::new();
    let _ = stream.read_to_string(&mut raw);
    let (headers, body) = raw.split_once("\r\n\r\n").unwrap_or((&raw, ""));
    let status = headers
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .ok_or(format!("no HTTP status from {host}"))?;
    let chunked = headers
        .to_ascii_lowercase()
        .contains("transfer-encoding: chunked");
    let body = match chunked {
        true => dechunk(body),
        false => body.to_string(),
    };
    Ok((status, body))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_matches_known_values_and_only_loopback_is_reached() {
        assert_eq!(base64(b"opencode:pw"), "b3BlbmNvZGU6cHc=");
        assert_eq!(base64(b"ab"), "YWI=");
        assert!(host_port("http://example.com:80/x").is_err());
        assert_eq!(
            host_port("http://127.0.0.1:4199/").unwrap(),
            "127.0.0.1:4199"
        );
        assert_eq!(dechunk("5\r\nhello\r\n0\r\n\r\n"), "hello");
    }
}
