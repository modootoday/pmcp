use crate::ip::public;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncReadExt, AsyncWriteExt, copy_bidirectional};
use tokio::net::{TcpListener, TcpStream, lookup_host};

// Chromium sends every request through this proxy (--proxy-server, loopback included), so the
// address policy holds whatever drives the browser: CDP, or the desktop typing into it.
const HEAD_LIMIT: usize = 16 * 1024;
const PUBLIC_PORTS: [u16; 2] = [80, 443];

/// host:port pairs the operator approved beyond public addresses ("localhost:5173", "10.0.0.5:*").
#[derive(Default, Clone)]
pub struct Policy {
    pub private: Vec<(String, Option<u16>)>,
}

impl Policy {
    pub fn parse(entries: &[String]) -> Result<Policy, String> {
        let mut private = Vec::new();
        for e in entries {
            let (host, port) = e
                .rsplit_once(':')
                .ok_or_else(|| format!("{e}: use host:port or host:*"))?;
            let port = match port {
                "*" => None,
                p => Some(p.parse().map_err(|_| format!("{e}: bad port"))?),
            };
            private.push((host.to_ascii_lowercase(), port));
        }
        Ok(Policy { private })
    }

    fn approved(&self, host: &str, port: u16) -> bool {
        let host = host.to_ascii_lowercase();
        self.private
            .iter()
            .any(|(h, p)| *h == host && p.is_none_or(|p| p == port))
    }
}

// Refusals with a running sequence number, the last 50 kept, so a reply can name exactly the
// ones its own call caused even after older entries are dropped.
pub type Blocked = Arc<Mutex<Vec<(u64, String)>>>;

pub fn last_seq(blocked: &Blocked) -> u64 {
    let list = blocked.lock().unwrap_or_else(|e| e.into_inner());
    list.last().map_or(0, |(seq, _)| *seq)
}

pub fn since(blocked: &Blocked, seq: u64) -> Vec<String> {
    let list = blocked.lock().unwrap_or_else(|e| e.into_inner());
    list.iter()
        .filter(|(s, _)| *s > seq)
        .map(|(_, why)| why.clone())
        .collect()
}

fn split_host(target: &str, default_port: u16) -> Option<(String, u16)> {
    let target = target.trim_start_matches('[');
    let (host, port) = match target.rsplit_once(':') {
        Some((h, p)) if p.chars().all(|c| c.is_ascii_digit()) => (h, p.parse().ok()?),
        _ => (target, default_port),
    };
    Some((host.trim_end_matches(']').to_string(), port))
}

/// Where a request may go: one vetted address, or why not.
pub async fn vet(policy: &Policy, host: &str, port: u16) -> Result<SocketAddr, String> {
    let approved = policy.approved(host, port);
    let addrs: Vec<SocketAddr> = lookup_host((host, port))
        .await
        .map_err(|e| format!("{host}: {e}"))?
        .collect();
    let first = *addrs.first().ok_or_else(|| format!("{host}: no address"))?;
    // The address first: a private host on any port is refused for being private.
    if !approved && let Some(bad) = addrs.iter().find(|a| !public(a.ip())) {
        return Err(format!(
            "{host}:{port}: {host} resolves to {}, which is not a public address",
            bad.ip()
        ));
    }
    if !approved && !PUBLIC_PORTS.contains(&port) {
        return Err(format!(
            "{host}:{port}: only ports 80 and 443 are open to public sites"
        ));
    }
    // Connecting to the address just checked, not the name again, keeps DNS rebinding out.
    Ok(first)
}

async fn deny(conn: &mut TcpStream, blocked: &Blocked, why: String) {
    let body = format!("pmcp-browser blocked this request: {why}\n");
    let reply = format!(
        "HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = conn.write_all(reply.as_bytes()).await;
    let mut list = blocked.lock().unwrap_or_else(|e| e.into_inner());
    let seq = list.last().map_or(1, |(s, _)| s + 1);
    list.push((seq, why));
    let excess = list.len().saturating_sub(50);
    list.drain(..excess);
}

async fn handle(mut conn: TcpStream, policy: Arc<Policy>, blocked: Blocked) {
    let mut head = Vec::new();
    let mut buf = [0u8; 4096];
    while !head.windows(4).any(|w| w == b"\r\n\r\n") {
        match conn.read(&mut buf).await {
            Ok(0) | Err(_) => return,
            Ok(n) => head.extend_from_slice(&buf[..n]),
        }
        if head.len() > HEAD_LIMIT {
            return deny(&mut conn, &blocked, "request head too large".into()).await;
        }
    }
    let line = String::from_utf8_lossy(&head)
        .lines()
        .next()
        .unwrap_or_default()
        .to_string();
    let mut parts = line.split_whitespace();
    let (method, target) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""));
    let connect = method.eq_ignore_ascii_case("CONNECT");
    let dest = match connect {
        true => split_host(target, 443),
        false => target
            .strip_prefix("http://")
            .and_then(|rest| split_host(rest.split('/').next()?, 80)),
    };
    let Some((host, port)) = dest else {
        return deny(
            &mut conn,
            &blocked,
            format!("only http and https requests are allowed: {line}"),
        )
        .await;
    };
    let addr = match vet(&policy, &host, port).await {
        Ok(a) => a,
        Err(why) => return deny(&mut conn, &blocked, why).await,
    };
    let Ok(mut upstream) = TcpStream::connect(addr).await else {
        return deny(
            &mut conn,
            &blocked,
            format!("{host}:{port} did not accept a connection"),
        )
        .await;
    };
    let ready = match connect {
        true => {
            conn.write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")
                .await
        }
        false => upstream.write_all(&head).await,
    };
    if ready.is_ok() {
        let _ = copy_bidirectional(&mut conn, &mut upstream).await;
    }
}

/// Serves until the listener fails; requests it refused are kept in blocked for the tools.
pub async fn serve(listener: TcpListener, policy: Arc<Policy>, blocked: Blocked) {
    while let Ok((conn, _)) = listener.accept().await {
        tokio::spawn(handle(conn, policy.clone(), blocked.clone()));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn private_addresses_need_approval_and_public_ones_only_web_ports() {
        let none = Policy::default();
        assert!(
            vet(&none, "127.0.0.1", 443)
                .await
                .unwrap_err()
                .contains("not a public address")
        );
        assert!(
            vet(&none, "localhost", 80)
                .await
                .unwrap_err()
                .contains("not a public address")
        );
        assert!(
            vet(&none, "1.1.1.1", 22)
                .await
                .unwrap_err()
                .contains("only ports 80 and 443")
        );
        assert!(vet(&none, "169.254.169.254", 80).await.is_err());
        let dev = Policy::parse(&["localhost:5173".into(), "127.0.0.1:*".into()]).unwrap();
        assert!(vet(&dev, "localhost", 5173).await.is_ok());
        assert!(vet(&dev, "localhost", 5174).await.is_err());
        assert!(vet(&dev, "127.0.0.1", 9).await.is_ok());
        assert!(Policy::parse(&["nohost".into()]).is_err());
        assert_eq!(split_host("[::1]:8080", 80), Some(("::1".into(), 8080)));
        assert_eq!(
            split_host("example.com", 443),
            Some(("example.com".into(), 443))
        );
    }
}
