use rmcp::model::{
    CallToolRequestParams, CallToolResponse, CallToolResult, ContentBlock, Implementation,
    ListToolsResult, PaginatedRequestParams, ServerCapabilities, ServerConfig, Tool,
    ToolAnnotations,
};
use rmcp::service::RequestContext;
use rmcp::{ErrorData, RoleServer, ServerHandler, ServiceExt};
use serde_json::{Map, Value};
use std::future::Future;
use std::sync::Arc;

// The plugins describe their tools as plain JSON Schemas and answer one call at a time; this
// keeps rmcp, which changes quickly, behind one small adapter.
pub struct ToolDef {
    pub name: &'static str,
    pub description: &'static str,
    pub schema: Value,
    pub read_only: bool,
}

pub enum Out {
    Text(String),
    // A screenshot: PNG bytes and a line saying what they show.
    Image { png: Vec<u8>, note: String },
    Error(String),
}

// A screenshot prints as its size, so a failed assertion does not dump megabytes.
impl std::fmt::Debug for Out {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Out::Text(t) => write!(f, "Text({t:?})"),
            Out::Image { png, note } => write!(f, "Image({} bytes, {note:?})", png.len()),
            Out::Error(e) => write!(f, "Error({e:?})"),
        }
    }
}

pub trait Tools: Send + Sync + 'static {
    fn tools(&self) -> Vec<ToolDef>;
    fn call(&self, name: &str, args: Value) -> impl Future<Output = Out> + Send;
}

/// A plugin that cannot start still lists its tools and answers each call with why, so the
/// agent and its operator see the reason instead of a server that vanished during startup.
pub struct Unavailable {
    pub reason: String,
    pub defs: fn() -> Vec<ToolDef>,
}

impl Tools for Unavailable {
    fn tools(&self) -> Vec<ToolDef> {
        (self.defs)()
    }

    async fn call(&self, _name: &str, _args: Value) -> Out {
        Out::Error(self.reason.clone())
    }
}

struct Server<T> {
    tools: Arc<T>,
    name: &'static str,
    version: &'static str,
}

fn tool(def: ToolDef) -> Tool {
    let schema: Map<String, Value> = match def.schema {
        Value::Object(map) => map,
        _ => Map::new(),
    };
    let mut t = Tool::new(def.name, def.description, Arc::new(schema));
    let mut notes = ToolAnnotations::default();
    notes.read_only_hint = Some(def.read_only);
    notes.open_world_hint = Some(false);
    t.annotations = Some(notes);
    t
}

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

pub fn base64(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = chunk
            .iter()
            .enumerate()
            .fold(0u32, |n, (i, b)| n | (*b as u32) << (16 - 8 * i));
        for i in 0..4 {
            match i <= chunk.len() {
                true => out.push(B64[(n >> (18 - 6 * i) & 63) as usize] as char),
                false => out.push('='),
            }
        }
    }
    out
}

fn result(out: Out) -> CallToolResult {
    match out {
        Out::Text(text) => CallToolResult::success(vec![ContentBlock::text(text)]),
        Out::Image { png, note } => CallToolResult::success(vec![
            ContentBlock::image(base64(&png), "image/png"),
            ContentBlock::text(note),
        ]),
        Out::Error(message) => CallToolResult::error(vec![ContentBlock::text(message)]),
    }
}

impl<T: Tools> ServerHandler for Server<T> {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new(self.name, self.version))
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        Ok(ListToolsResult::with_all_items(
            self.tools.tools().into_iter().map(tool).collect(),
        ))
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        let args = Value::Object(request.arguments.unwrap_or_default());
        Ok(result(self.tools.call(&request.name, args).await).into())
    }
}

/// Serves the tools on stdin and stdout until the client goes away.
pub async fn serve_stdio<T: Tools>(
    tools: T,
    name: &'static str,
    version: &'static str,
) -> Result<(), String> {
    let server = Server {
        tools: Arc::new(tools),
        name,
        version,
    };
    let running = server
        .serve(rmcp::transport::stdio())
        .await
        .map_err(|e| e.to_string())?;
    running.waiting().await.map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_matches_the_standard_alphabet_and_padding() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
    }
}
