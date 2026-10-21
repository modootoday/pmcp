use crate::error::{Code, Fail};
use crate::proto::LeaseReq;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

// The harness grants leases (control/leases.ts); pmcp-pty only holds the token it is given and
// requires it on every input while the lease is live, so two controllers never type at once.
const DEFAULT_TTL: Duration = Duration::from_secs(60);
const MAX_TTL: Duration = Duration::from_secs(3600);

#[derive(Default)]
pub struct Leases {
    by_session: Mutex<HashMap<String, (String, Instant)>>,
}

impl Leases {
    fn live(map: &mut HashMap<String, (String, Instant)>, id: &str) -> Option<String> {
        match map.get(id) {
            Some((token, until)) if *until > Instant::now() => Some(token.clone()),
            Some(_) => {
                map.remove(id);
                None
            }
            None => None,
        }
    }

    pub fn set(&self, id: &str, req: &LeaseReq) -> Result<Value, Fail> {
        let mut map = self.by_session.lock().unwrap_or_else(|e| e.into_inner());
        let held = Self::live(&mut map, id);
        if held.is_some() && held != req.current && held != req.token {
            return Err(Fail::new(
                Code::Lease,
                format!("session {id} is leased to another controller"),
            ));
        }
        if req.release {
            map.remove(id);
            return Ok(json!({ "ok": true, "leased": false }));
        }
        let Some(token) = req.token.clone().filter(|t| !t.is_empty()) else {
            return Err(Fail::new(
                Code::BadRequest,
                "lease needs a token, or release",
            ));
        };
        let ttl = req
            .ttl_ms
            .map(Duration::from_millis)
            .unwrap_or(DEFAULT_TTL)
            .min(MAX_TTL);
        map.insert(id.to_string(), (token, Instant::now() + ttl));
        Ok(json!({ "ok": true, "leased": true, "ttl_ms": ttl.as_millis() as u64 }))
    }

    pub fn check(&self, id: &str, presented: Option<&str>) -> Result<(), Fail> {
        let mut map = self.by_session.lock().unwrap_or_else(|e| e.into_inner());
        match Self::live(&mut map, id) {
            Some(token) if presented != Some(token.as_str()) => Err(Fail::new(
                Code::Lease,
                format!("session {id} is leased; pass its token in expect.lease"),
            )),
            _ => Ok(()),
        }
    }

    pub fn leased(&self, id: &str) -> bool {
        let mut map = self.by_session.lock().unwrap_or_else(|e| e.into_inner());
        Self::live(&mut map, id).is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(token: Option<&str>, current: Option<&str>, release: bool) -> LeaseReq {
        LeaseReq {
            id: "s1".into(),
            token: token.map(String::from),
            ttl_ms: Some(60_000),
            current: current.map(String::from),
            release,
        }
    }

    #[test]
    fn only_the_holder_writes_renews_or_releases_and_a_lapsed_lease_frees_the_session() {
        let l = Leases::default();
        assert!(l.check("s1", None).is_ok());
        l.set("s1", &req(Some("a"), None, false)).unwrap();
        assert_eq!(l.check("s1", None).unwrap_err().code, Code::Lease);
        assert_eq!(l.check("s1", Some("b")).unwrap_err().code, Code::Lease);
        assert!(l.check("s1", Some("a")).is_ok());
        assert_eq!(
            l.set("s1", &req(Some("b"), None, false)).unwrap_err().code,
            Code::Lease
        );
        assert!(l.set("s1", &req(Some("a"), None, false)).is_ok());
        assert!(l.set("s1", &req(Some("b"), Some("a"), false)).is_ok());
        assert_eq!(
            l.set("s1", &req(None, Some("a"), true)).unwrap_err().code,
            Code::Lease
        );
        l.set("s1", &req(None, Some("b"), true)).unwrap();
        assert!(!l.leased("s1"));
        let mut short = req(Some("c"), None, false);
        short.ttl_ms = Some(1);
        l.set("s1", &short).unwrap();
        std::thread::sleep(Duration::from_millis(5));
        assert!(l.check("s1", None).is_ok());
    }
}
