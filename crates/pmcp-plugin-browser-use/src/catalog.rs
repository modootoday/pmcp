use pmcp_plugin_support::mcp::ToolDef;
use serde_json::{Value, json};

// The tools pmcp-browser offers. Page text and screenshots are the site's content, not
// instructions; refs come from the latest snapshot and are replaced by the next one.
fn schema(props: Value, required: &[&str]) -> Value {
    json!({ "type": "object", "properties": props, "required": required, "additionalProperties": false })
}

fn target(extra: Value) -> Value {
    let mut p = json!({
        "ref": { "type": "string", "description": "e.g. e4, from the latest snapshot" },
        "selector": { "type": "string", "description": "a CSS selector" },
        "x": { "type": "number" }, "y": { "type": "number" }
    });
    if let (Some(p), Some(extra)) = (p.as_object_mut(), extra.as_object()) {
        p.extend(extra.clone());
    }
    p
}

fn def(name: &'static str, description: &'static str, schema: Value, read_only: bool) -> ToolDef {
    ToolDef {
        name,
        description,
        schema,
        read_only,
    }
}

pub fn defs() -> Vec<ToolDef> {
    vec![
        def(
            "navigate",
            "Open an http or https URL in the current tab. Only public sites load unless the operator approved a private address; refused requests are listed in the reply.",
            schema(json!({ "url": { "type": "string" } }), &["url"]),
            false,
        ),
        def(
            "snapshot",
            "The page's accessibility tree as an outline; each control has a ref such as e4 for click and type.",
            schema(json!({}), &[]),
            true,
        ),
        def(
            "click",
            "Click an element by ref or CSS selector, or a viewport point; double for a double click.",
            schema(target(json!({ "double": { "type": "boolean" } })), &[]),
            false,
        ),
        def(
            "type",
            "Type text into an element by ref or selector (or the point's element); submit presses Enter after.",
            schema(
                target(
                    json!({ "text": { "type": "string", "maxLength": 20000 }, "submit": { "type": "boolean" } }),
                ),
                &["text"],
            ),
            false,
        ),
        def(
            "press",
            "Press a key or chord in the page: Enter, Tab, Escape, ArrowDown, ctrl+a, shift+Tab.",
            schema(json!({ "keys": { "type": "string" } }), &["keys"]),
            false,
        ),
        def(
            "read_text",
            "The page's visible text, up to max_chars (default 20000).",
            schema(
                json!({ "max_chars": { "type": "integer", "minimum": 1, "maximum": 100000 } }),
                &[],
            ),
            true,
        ),
        def(
            "screenshot",
            "A PNG of the current tab's viewport.",
            schema(json!({}), &[]),
            true,
        ),
        def(
            "tabs",
            "List tabs, open a new one (optionally at a url), select or close one by index.",
            schema(
                json!({
                    "action": { "enum": ["list", "new", "select", "close"] },
                    "index": { "type": "integer", "minimum": 0 },
                    "url": { "type": "string" }
                }),
                &[],
            ),
            false,
        ),
        def(
            "wait_for",
            "Wait until the page shows a text or matches a CSS selector, up to timeout_ms (at most 30000).",
            schema(
                json!({
                    "text": { "type": "string" }, "selector": { "type": "string" },
                    "timeout_ms": { "type": "integer", "minimum": 0, "maximum": 30000 }
                }),
                &[],
            ),
            true,
        ),
        def(
            "downloads",
            "Files this browser downloaded, with sizes.",
            schema(json!({}), &[]),
            true,
        ),
        def(
            "close",
            "Close the browser and delete its profile; the next call starts a fresh one.",
            schema(json!({}), &[]),
            false,
        ),
    ]
}
