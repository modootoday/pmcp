use crate::display::Desktop;
use crate::image::shot;
use crate::keys::chord;
use crate::launch;
use crate::x::X;
use pmcp_plugin_support::mcp::{Out, ToolDef, Tools};
use serde_json::Value;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

pub struct Desk {
    pub desktop: Desktop,
    x: Mutex<X>,
    // Screen pixels per screenshot pixel, from the last screenshot the model saw.
    scale: Mutex<f64>,
    approved: Option<PathBuf>,
    launched: Mutex<Vec<Child>>,
}

const MAX_TYPE: usize = 2000;

fn num(args: &Value, key: &str) -> Result<i64, String> {
    args[key]
        .as_i64()
        .ok_or_else(|| format!("{key} must be an integer"))
}

impl Desk {
    pub fn new(desktop: Desktop, approved: Option<PathBuf>) -> Result<Desk, String> {
        let x = X::connect(desktop.display, &desktop.cookie)?;
        Ok(Desk {
            desktop,
            x: Mutex::new(x),
            scale: Mutex::new(1.0),
            approved,
            launched: Mutex::new(Vec::new()),
        })
    }

    fn x(&self) -> std::sync::MutexGuard<'_, X> {
        self.x.lock().unwrap_or_else(|e| e.into_inner())
    }

    // Coordinates come in screenshot pixels and go to the screen through the last scale.
    fn point(&self, args: &Value, kx: &str, ky: &str) -> Result<(i16, i16), String> {
        let scale = *self.scale.lock().unwrap_or_else(|e| e.into_inner());
        let x = self.x();
        let sx = ((num(args, kx)? as f64) * scale).round() as i64;
        let sy = ((num(args, ky)? as f64) * scale).round() as i64;
        if sx >= x.width as i64 || sy >= x.height as i64 || sx < 0 || sy < 0 {
            return Err(format!(
                "({sx}, {sy}) is off the {}x{} screen",
                x.width, x.height
            ));
        }
        Ok((sx as i16, sy as i16))
    }

    pub fn screenshot(&self) -> Result<Out, String> {
        let x = self.x();
        let rgb = x.capture()?;
        let s = shot(&rgb, x.width as u32, x.height as u32)?;
        *self.scale.lock().unwrap_or_else(|e| e.into_inner()) = s.scale;
        let note = format!(
            "{}x{} screenshot of {} ({}x{}); give coordinates in screenshot pixels",
            s.width,
            s.height,
            self.desktop.name(),
            x.width,
            x.height
        );
        Ok(Out::Image { png: s.png, note })
    }

    fn click(&self, args: &Value, times: u8) -> Result<Out, String> {
        let (px, py) = self.point(args, "x", "y")?;
        let button = match args["button"].as_str().unwrap_or("left") {
            "left" => 1,
            "middle" => 2,
            "right" => 3,
            other => return Err(format!("unknown button {other}")),
        };
        let x = self.x();
        x.move_to(px, py)?;
        for _ in 0..times {
            x.button(button, true)?;
            x.button(button, false)?;
        }
        x.flush()?;
        Ok(Out::Text(format!("clicked {times}x at ({px}, {py})")))
    }

    fn drag(&self, args: &Value) -> Result<Out, String> {
        let from = self.point(args, "from_x", "from_y")?;
        let to = self.point(args, "to_x", "to_y")?;
        let x = self.x();
        x.move_to(from.0, from.1)?;
        x.button(1, true)?;
        x.move_to(to.0, to.1)?;
        x.button(1, false)?;
        x.flush()?;
        Ok(Out::Text(format!("dragged {from:?} to {to:?}")))
    }

    fn type_text(&self, args: &Value) -> Result<Out, String> {
        let text = args["text"].as_str().ok_or("text must be a string")?;
        if text.chars().count() > MAX_TYPE {
            return Err(format!("text is longer than {MAX_TYPE} characters"));
        }
        let mut x = self.x();
        for c in text.chars() {
            x.char(c)?;
        }
        x.flush()?;
        Ok(Out::Text(format!(
            "typed {} characters",
            text.chars().count()
        )))
    }

    fn key(&self, args: &Value) -> Result<Out, String> {
        let keys = args["keys"]
            .as_str()
            .ok_or("keys must be a string such as ctrl+l")?;
        let syms = chord(keys)?;
        let mut x = self.x();
        for s in &syms {
            x.key(*s, true)?;
        }
        for s in syms.iter().rev() {
            x.key(*s, false)?;
        }
        x.flush()?;
        Ok(Out::Text(format!("pressed {keys}")))
    }

    fn scroll(&self, args: &Value) -> Result<Out, String> {
        let (px, py) = self.point(args, "x", "y")?;
        let button = match args["direction"].as_str().unwrap_or("down") {
            "up" => 4,
            "down" => 5,
            "left" => 6,
            "right" => 7,
            other => return Err(format!("unknown direction {other}")),
        };
        let amount = args["amount"].as_i64().unwrap_or(3).clamp(1, 20);
        let x = self.x();
        x.move_to(px, py)?;
        for _ in 0..amount {
            x.button(button, true)?;
            x.button(button, false)?;
        }
        x.flush()?;
        Ok(Out::Text(format!("scrolled {amount} at ({px}, {py})")))
    }

    fn launch(&self, args: &Value) -> Result<Out, String> {
        let want = args["app"]
            .as_str()
            .ok_or("app must be a name from the approved list")?;
        let (apps, _) = launch::approved(self.approved.as_deref())?;
        let app = apps.iter().find(|a| a.name == want).ok_or_else(|| {
            let names: Vec<&str> = apps.iter().map(|a| a.name.as_str()).collect();
            format!("{want} is not approved; approved: {}", names.join(", "))
        })?;
        let child = Command::new(&app.argv[0])
            .args(&app.argv[1..])
            .envs(self.desktop.env())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("{}: {e}", app.argv[0]))?;
        let pid = child.id();
        self.launched
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(child);
        Ok(Out::Text(format!(
            "launched {want} (pid {pid}) on {}",
            self.desktop.name()
        )))
    }

    /// One tool call, as the MCP server makes it; the tests drive the desktop through this too.
    pub fn run(&self, name: &str, args: &Value) -> Result<Out, String> {
        match name {
            "screenshot" => self.screenshot(),
            "click" => self.click(args, 1),
            "double_click" => self.click(args, 2),
            "drag" => self.drag(args),
            "type" => self.type_text(args),
            "key" => self.key(args),
            "scroll" => self.scroll(args),
            "cursor_position" => {
                let (px, py) = self.x().pointer()?;
                let scale = *self.scale.lock().unwrap_or_else(|e| e.into_inner());
                let (sx, sy) = ((px as f64 / scale).round(), (py as f64 / scale).round());
                Ok(Out::Text(format!(
                    "screen ({px}, {py}); screenshot ({sx}, {sy})"
                )))
            }
            "launch" => self.launch(args),
            "viewer_info" => Ok(Out::Text(format!(
                "display {} at {}x{}; viewer off (no VNC on this host); the operator watches screenshots",
                self.desktop.name(),
                self.desktop.width,
                self.desktop.height
            ))),
            other => Err(format!("unknown tool {other}")),
        }
    }
}

impl Drop for Desk {
    fn drop(&mut self) {
        let mut launched = self.launched.lock().unwrap_or_else(|e| e.into_inner());
        let roots: Vec<u32> = launched.iter().map(Child::id).collect();
        pmcp_plugin_support::reap::terminate(&roots, pmcp_plugin_support::reap::GRACE);
        for child in launched.iter_mut() {
            let _ = child.wait();
        }
    }
}

impl Tools for Desk {
    fn tools(&self) -> Vec<ToolDef> {
        crate::catalog::defs()
    }

    async fn call(&self, name: &str, args: Value) -> Out {
        self.run(name, &args).unwrap_or_else(Out::Error)
    }
}
