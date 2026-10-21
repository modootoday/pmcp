use super::Daemon;
use crate::audit::op_name;
use crate::error::{Code, Fail};
use crate::proto::Request;
use serde_json::{Map, Value, json};

// One line per op: name|read or write|fields (name:type, ! when required)|a line for callers.
// describe turns the lines into JSON Schemas, so the file is the contract.
const OPS: &str = include_str!("describe_ops.txt");

const CODES: &[&str] = &[
    "bad_request",
    "not_found",
    "exited",
    "busy",
    "dialog_open",
    "guard",
    "timeout",
    "lease",
    "conflict",
    "stale",
];

// Over MCP only these, and the write ones only with the operator's mcp_write; answer never.
const MCP_READ: &[&str] = &["describe", "list", "observe", "wait", "read"];
const MCP_WRITE: &[&str] = &["turn", "lease"];

fn schema(op: &str, fields: &str) -> Value {
    let mut properties = Map::new();
    properties.insert("op".into(), json!({ "const": op }));
    let mut required = vec![json!("op")];
    for field in fields.split(',').filter(|f| !f.is_empty()) {
        let (name, kind) = field.split_once(':').unwrap_or((field, "string"));
        let needed = kind.ends_with('!');
        let kind = kind.trim_end_matches('!');
        properties.insert(name.into(), json!({ "type": kind }));
        if needed {
            required.push(json!(name));
        }
    }
    json!({ "type": "object", "properties": properties, "required": required })
}

fn mcp_of(op: &str) -> &'static str {
    match () {
        _ if MCP_READ.contains(&op) => "read",
        _ if MCP_WRITE.contains(&op) => "write",
        _ => "never",
    }
}

fn ops() -> Vec<Value> {
    OPS.lines()
        .filter_map(|line| {
            let mut parts = line.splitn(4, '|');
            let (op, kind, fields, about) = (parts.next()?, parts.next()?, parts.next()?, parts.next()?);
            let read_only = kind == "read";
            Some(json!({ "op": op, "about": about, "read_only": read_only, "mcp": mcp_of(op), "request": schema(op, fields) }))
        })
        .collect()
}

impl Daemon {
    pub(super) fn describe(&self) -> Value {
        let profiles: Vec<Value> = self
            .profiles
            .all()
            .iter()
            .map(|p| {
                let delivery = p.delivery.clone().unwrap_or_else(|| "screen".into());
                json!({ "name": p.name, "version": p.version, "delivery": delivery })
            })
            .collect();
        json!({
            "ok": true, "version": env!("CARGO_PKG_VERSION"), "instance": self.instance,
            "ops": ops(), "codes": CODES, "profiles": profiles, "policy": self.policy_state(),
        })
    }

    /// The daemon's own check on requests from pmcp harness mcp, so a bug in that server cannot
    /// widen what MCP reaches.
    pub fn mcp_gate(&self, req: &Request) -> Result<(), Fail> {
        let op = op_name(req);
        let write = self.policy_state()["mcp_write"] == true;
        match mcp_of(&op) {
            "read" => Ok(()),
            "write" if write => Ok(()),
            "write" => Err(Fail::new(
                Code::Guard,
                format!("{op} over MCP needs mcp_write in the operator policy"),
            )),
            _ => Err(Fail::new(
                Code::Guard,
                format!("{op} is not available over MCP"),
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_op_has_a_schema_and_answer_never_reaches_mcp() {
        let all = ops();
        let turn = all.iter().find(|o| o["op"] == "turn").unwrap();
        assert_eq!(turn["request"]["required"], json!(["op", "id", "text"]));
        assert_eq!(turn["mcp"], "write");
        let answer = all.iter().find(|o| o["op"] == "answer").unwrap();
        assert_eq!(answer["mcp"], "never");
        let names: Vec<&str> = all.iter().map(|o| o["op"].as_str().unwrap()).collect();
        for op in MCP_READ.iter().chain(MCP_WRITE) {
            assert!(names.contains(op), "{op}");
        }
        // Every op the protocol parses is described.
        for op in names.iter() {
            let line = format!(r#"{{"op":"{op}"}}"#);
            let parsed = serde_json::from_str::<Request>(&line);
            assert!(
                parsed.is_ok() || parsed.unwrap_err().to_string().contains("missing field"),
                "{op}"
            );
        }
        assert_eq!(names.len(), 24);
    }
}
