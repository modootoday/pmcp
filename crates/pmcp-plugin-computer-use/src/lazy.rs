use crate::display::Desktop;
use crate::tools::Desk;
use pmcp_plugin_support::mcp::{Out, ToolDef, Tools};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Mutex;

// The desktop starts on the first tool call, so the server answers MCP initialize at once
// whatever starting Xvfb costs, and a client that never uses it never starts one.
pub struct LazyDesk {
    pub state: PathBuf,
    pub geometry: (u16, u16, u8),
    pub approved: Option<PathBuf>,
    desk: Mutex<Option<Desk>>,
}

impl LazyDesk {
    pub fn new(state: PathBuf, geometry: (u16, u16, u8), approved: Option<PathBuf>) -> LazyDesk {
        LazyDesk {
            state,
            geometry,
            approved,
            desk: Mutex::new(None),
        }
    }

    fn run(&self, name: &str, args: &Value) -> Result<Out, String> {
        let mut desk = self.desk.lock().unwrap_or_else(|e| e.into_inner());
        if desk.is_none() {
            let (w, h, d) = self.geometry;
            let desktop = Desktop::start(&self.state, w, h, d)?;
            *desk = Some(Desk::new(desktop, self.approved.clone())?);
        }
        desk.as_ref().ok_or("no desktop")?.run(name, args)
    }
}

impl Tools for LazyDesk {
    fn tools(&self) -> Vec<ToolDef> {
        crate::catalog::defs()
    }

    async fn call(&self, name: &str, args: Value) -> Out {
        self.run(name, &args).unwrap_or_else(Out::Error)
    }
}
