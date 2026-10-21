// Requests about who may drive a session: attaching, the harness lease and dialog answers.
use super::{Expect, Request};
use crate::error::{Code, Fail};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// One request line, and whether it came through pmcp harness mcp (via "mcp"), which the
/// daemon then limits itself.
pub fn parse_line(line: &str) -> Result<(Request, bool), Fail> {
    let bad = |e: serde_json::Error| Fail::new(Code::BadRequest, format!("bad request: {e}"));
    let value: Value = serde_json::from_str(line).map_err(bad)?;
    let mcp = value.get("via").and_then(Value::as_str) == Some("mcp");
    Ok((serde_json::from_value(value).map_err(bad)?, mcp))
}

/// An attach sized to the client's terminal resizes the session while it is attached; the
/// size from before the first sized attach comes back when the last one leaves.
#[derive(Serialize, Deserialize, Debug, Default, Clone)]
pub struct AttachReq {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cols: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rows: Option<u16>,
    #[serde(default)]
    pub read_only: bool,
    /// Resize to cols and rows; defaults to yes for a writable attach and no for a read-only
    /// viewer, which should not reflow a session someone else is driving.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resize: Option<bool>,
    /// The harness lease token; while the session is leased, a writable attach needs it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lease: Option<String>,
}

/// The harness lease, which the harness grants: pmcp-pty only holds the token it is given and
/// requires it on every input while it is live. Release, or replace, needs the current token.
#[derive(Serialize, Deserialize, Debug, Default, Clone)]
pub struct LeaseReq {
    pub id: String,
    #[serde(default)]
    pub token: Option<String>,
    #[serde(default)]
    pub ttl_ms: Option<u64>,
    #[serde(default)]
    pub current: Option<String>,
    #[serde(default)]
    pub release: bool,
}

/// Choose an option in the dialog on screen; allowed only by the operator's answer policy.
#[derive(Serialize, Deserialize, Debug, Default, Clone)]
pub struct AnswerReq {
    pub id: String,
    pub dialog: String,
    pub option: String,
    #[serde(default)]
    pub expect: Option<Expect>,
}
