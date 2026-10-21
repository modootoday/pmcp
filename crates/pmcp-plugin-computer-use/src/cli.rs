use pmcp_plugin_computer_use::{checks::checks, lazy::LazyDesk};
use pmcp_plugin_support::doctor::{Status, exit_code, plan, render};
use pmcp_plugin_support::mcp::{Tools, Unavailable};
use pmcp_plugin_support::scope::{Limits, reexec_scoped};
use std::path::PathBuf;

const USAGE: &str = "usage:
  pmcp-desktop serve [--geometry 1440x900x24] [--memory-max 512M] [--approved <dir>] [--no-scope]
  pmcp-desktop doctor [--json]
  pmcp-desktop setup [--plan | --apply]
serve speaks MCP on stdio. --approved is the directory pmcp harness host approve wrote; without
it launch is off. Root packages are printed by setup, never installed.";

struct Args {
    cmd: String,
    geometry: (u16, u16, u8),
    memory_max: String,
    approved: Option<PathBuf>,
    no_scope: bool,
    json: bool,
    apply: bool,
}

fn geometry(text: &str) -> Result<(u16, u16, u8), String> {
    let parts: Vec<&str> = text.split('x').collect();
    let bad = || format!("--geometry {text}: use WIDTHxHEIGHTxDEPTH, depth 24");
    let [w, h, d] = parts.as_slice() else {
        return Err(bad());
    };
    let w: u16 = w.parse().map_err(|_| bad())?;
    let h: u16 = h.parse().map_err(|_| bad())?;
    let d: u8 = d.parse().map_err(|_| bad())?;
    if d != 24 || !(320..=7680).contains(&w) || !(200..=4320).contains(&h) {
        return Err(bad());
    }
    Ok((w, h, d))
}

fn parse() -> Result<Args, String> {
    let mut raw = std::env::args().skip(1);
    let cmd = raw.next().ok_or(USAGE)?;
    let mut a = Args {
        cmd,
        geometry: (1440, 900, 24),
        memory_max: "512M".into(),
        approved: None,
        no_scope: false,
        json: false,
        apply: false,
    };
    while let Some(flag) = raw.next() {
        let mut value = || raw.next().ok_or(format!("{flag} needs a value"));
        match flag.as_str() {
            "--geometry" => a.geometry = geometry(&value()?)?,
            "--memory-max" => a.memory_max = value()?,
            "--approved" => a.approved = Some(PathBuf::from(value()?)),
            "--no-scope" => a.no_scope = true,
            "--json" => a.json = true,
            "--plan" => a.apply = false,
            "--apply" => a.apply = true,
            other => return Err(format!("unknown option {other}\n{USAGE}")),
        }
    }
    Ok(a)
}

fn state_dir() -> PathBuf {
    let home = PathBuf::from(std::env::var_os("HOME").unwrap_or_default());
    let base = std::env::var_os("XDG_STATE_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".local/state"));
    base.join("pmcp-plugins").join("desktop")
}

fn doctor(json: bool) -> i32 {
    let checks = checks();
    if !json {
        print!("{}", render(&checks));
        return exit_code(&checks);
    }
    let rows: Vec<serde_json::Value> = checks
        .iter()
        .map(|c| {
            let status = format!("{:?}", c.status).to_uppercase();
            let fix = c.fix.as_ref().map(|f| f.0.clone());
            let root = c.fix.as_ref().map(|f| f.1);
            serde_json::json!({ "check": c.name, "status": status, "found": c.found, "fix": fix, "root": root })
        })
        .collect();
    println!("{}", serde_json::Value::Array(rows));
    exit_code(&checks)
}

fn serve(a: &Args) -> Result<i32, String> {
    if let Some(reason) = pmcp_plugin_support::platform::plugins_unsupported() {
        eprintln!("pmcp-desktop: {reason}");
        let defs = pmcp_plugin_computer_use::catalog::defs;
        return mcp(Unavailable { reason, defs });
    }
    if !a.no_scope {
        let unit = format!("pmcp-desktop-{}", std::process::id());
        let limits = Limits {
            memory_max: a.memory_max.clone(),
            tasks_max: 256,
        };
        match reexec_scoped(&unit, &limits) {
            Ok(Some(code)) => return Ok(code),
            Ok(None) => {}
            // Still answer MCP, with the reason on every call: a server that exits at startup
            // looks to the agent like a tool that was never there.
            Err(reason) => {
                eprintln!("pmcp-desktop: {reason}");
                let defs = pmcp_plugin_computer_use::catalog::defs;
                return mcp(Unavailable { reason, defs });
            }
        }
    }
    mcp(LazyDesk::new(state_dir(), a.geometry, a.approved.clone()))
}

fn mcp<T: Tools>(tools: T) -> Result<i32, String> {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .map_err(|e| e.to_string())?;
    let version = env!("CARGO_PKG_VERSION");
    runtime.block_on(pmcp_plugin_support::mcp::serve_stdio(
        tools,
        "pmcp-desktop",
        version,
    ))?;
    Ok(0)
}

fn setup(apply: bool) -> i32 {
    let checks = checks();
    print!("{}", plan(&checks));
    // Nothing pmcp-desktop needs is user level, so --apply only reports what is still unmet.
    let unmet = checks.iter().any(|c| c.status == Status::Missing);
    if apply && unmet {
        eprintln!("pmcp-desktop: run the operator steps above, then pmcp-desktop doctor");
    }
    i32::from(unmet)
}

pub fn main() {
    let code = match parse() {
        Err(e) => {
            eprintln!("pmcp-desktop: {e}");
            2
        }
        Ok(a) => match a.cmd.as_str() {
            "doctor" => doctor(a.json),
            "setup" => setup(a.apply),
            "serve" => serve(&a).unwrap_or_else(|e| {
                eprintln!("pmcp-desktop: {e}");
                1
            }),
            _ => {
                eprintln!("{USAGE}");
                2
            }
        },
    };
    std::process::exit(code);
}
