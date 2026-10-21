use serde::Serialize;
use serde_json::{Value, json};

// A stable code lets an AI caller branch on the failure without parsing English messages.
#[derive(Serialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum Code {
    BadRequest,
    NotFound,
    Exited,
    Busy,
    DialogOpen,
    Guard,
    Timeout,
    Lease,
    Conflict,
    Stale,
}

#[derive(Debug, PartialEq)]
pub struct Fail {
    pub code: Code,
    pub message: String,
    pub retry_after_ms: Option<u64>,
}

impl Fail {
    pub fn new(code: Code, message: impl Into<String>) -> Fail {
        Fail {
            code,
            message: message.into(),
            retry_after_ms: None,
        }
    }

    pub fn reply(&self) -> Value {
        let mut v = json!({ "ok": false, "code": self.code, "message": self.message });
        if let Some(ms) = self.retry_after_ms {
            v["retry_after_ms"] = json!(ms);
        }
        v
    }
}

// Plain string errors come from request parsing and spawn setup, which the caller must fix.
impl From<String> for Fail {
    fn from(message: String) -> Fail {
        Fail::new(Code::BadRequest, message)
    }
}

pub fn code_name(code: Code) -> String {
    serde_json::to_value(code)
        .ok()
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reply_carries_code_and_message() {
        let mut fail = Fail::new(Code::DialogOpen, "dialog detected: proceed");
        fail.retry_after_ms = Some(500);
        let v = fail.reply();
        assert_eq!(v["ok"], false);
        assert_eq!(v["code"], "dialog_open");
        assert_eq!(v["message"], "dialog detected: proceed");
        assert_eq!(v["retry_after_ms"], 500);
        assert_eq!(code_name(Code::BadRequest), "bad_request");
    }
}
