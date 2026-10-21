use pmcp_plugin_browser_use::checks::{self, checks};
use pmcp_plugin_browser_use::limits::take_slot;
use pmcp_plugin_browser_use::proxy::{self, Blocked, Policy};
use pmcp_plugin_browser_use::session::Launch;
use pmcp_plugin_browser_use::tools::Browse;
use pmcp_plugin_support::doctor::{Status, exit_code, plan, render};
use pmcp_plugin_support::mcp::Unavailable;
use pmcp_plugin_support::scope::{Limits, reexec_scoped};
use std::path::{Path, PathBuf};
use std::sync::Arc;

const USAGE: &str = "usage:
  pmcp-browser serve [--memory-max 2G] [--approved <dir>] [--display :N --xauthority <file>] [--no-scope]
  pmcp-browser doctor [--json]
  pmcp-browser setup [--plan | --apply]
serve speaks MCP on stdio: public http(s) sites only, fresh profile, Chromium sandbox on.
--approved is the directory pmcp harness host approve wrote; its browser.allow_private
(host:port entries) is the only way to reach private addresses. --display runs headed on
pmcp-desktop's display and needs the managed policy setup prints.";

#[derive(Default)]
struct Args {
    cmd: String,
    memory_max: String,
    approved: Option<PathBuf>,
    display: Option<String>,
    xauthority: Option<PathBuf>,
    no_scope: bool,
    json: bool,
    apply: bool,
}

fn parse() -> Result<Args, String> {
    let mut raw = std::env::args().skip(1);
    let cmd = raw.next().ok_or(USAGE)?;
    let mut a = Args {
        cmd,
        memory_max: "2G".into(),
        ..Args::default()
    };
    while let Some(flag) = raw.next() {
        let mut value = || raw.next().ok_or(format!("{flag} needs a value"));
        match flag.as_str() {
            "--memory-max" => a.memory_max = value()?,
            "--approved" => a.approved = Some(PathBuf::from(value()?)),
            "--display" => a.display = Some(value()?),
            "--xauthority" => a.xauthority = Some(PathBuf::from(value()?)),
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
    base.join("pmcp-plugins").join("browser")
}

// Private addresses only from the operator-approved copy; without one, public sites only.
fn policy(approved: Option<&Path>) -> Result<Policy, String> {
    let Some(dir) = approved else {
        return Ok(Policy::default());
    };
    let text = pmcp_plugin_support::approved::policy_text(dir)?;
    let v: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("policy.json: {e}"))?;
    let list: Vec<String> = v["browser"]["allow_private"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|s| s.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    Policy::parse(&list)
}

fn display_env(a: &Args) -> Result<Option<[(String, String); 2]>, String> {
    let Some(display) = &a.display else {
        return Ok(None);
    };
    if checks::managed_policy_installed().is_none() {
        return Err("headed mode needs the managed policy; see pmcp-browser setup --plan".into());
    }
    let xauth = a
        .xauthority
        .as_ref()
        .ok_or("--display needs --xauthority (pmcp-desktop's file)")?;
    Ok(Some([
        ("DISPLAY".into(), display.clone()),
        ("XAUTHORITY".into(), xauth.display().to_string()),
    ]))
}

// A server that cannot start (no scope, both slots taken, a bad approved copy) still answers
// MCP with the reason on every call: one that exits at startup looks like a missing tool.
fn unavailable(reason: String) -> Result<i32, String> {
    eprintln!("pmcp-browser: {reason}");
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| e.to_string())?;
    let tools = Unavailable {
        reason,
        defs: pmcp_plugin_browser_use::catalog::defs,
    };
    let version = env!("CARGO_PKG_VERSION");
    runtime.block_on(pmcp_plugin_support::mcp::serve_stdio(
        tools,
        "pmcp-browser",
        version,
    ))?;
    Ok(0)
}

fn serve(a: &Args) -> Result<i32, String> {
    if let Some(reason) = pmcp_plugin_support::platform::plugins_unsupported() {
        return unavailable(reason);
    }
    if !a.no_scope {
        let unit = format!("pmcp-browser-{}", std::process::id());
        let limits = Limits {
            memory_max: a.memory_max.clone(),
            tasks_max: 1024,
        };
        match reexec_scoped(&unit, &limits) {
            Ok(Some(code)) => return Ok(code),
            Ok(None) => {}
            Err(reason) => return unavailable(reason),
        }
    }
    let state = state_dir();
    let ready = take_slot(&state).and_then(|slot| {
        let policy = policy(a.approved.as_deref())?;
        Ok((slot, display_env(a)?, Arc::new(policy)))
    });
    let (_slot, display, policy) = match ready {
        Ok(ready) => ready,
        Err(reason) => return unavailable(reason),
    };
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .map_err(|e| e.to_string())?;
    runtime.block_on(async move {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| e.to_string())?;
        let proxy_port = listener.local_addr().map_err(|e| e.to_string())?.port();
        let blocked: Blocked = Default::default();
        tokio::spawn(proxy::serve(listener, policy, blocked.clone()));
        let pid = std::process::id();
        let launch = Launch {
            chromium: None,
            profile: state.join("profiles"),
            downloads: state.join(format!("downloads-{pid}")),
            proxy_port,
            display,
        };
        let version = env!("CARGO_PKG_VERSION");
        pmcp_plugin_support::mcp::serve_stdio(Browse::new(launch, blocked), "pmcp-browser", version)
            .await
    })?;
    Ok(0)
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
            serde_json::json!({ "check": c.name, "status": status, "found": c.found, "fix": c.fix.as_ref().map(|f| &f.0), "root": c.fix.as_ref().map(|f| f.1) })
        })
        .collect();
    println!("{}", serde_json::Value::Array(rows));
    exit_code(&checks)
}

// The only user-level step: adopt the matching Playwright build as a symlink. Downloads and root
// steps are printed, never run.
fn setup(apply: bool) -> i32 {
    let list = checks();
    print!("{}", plan(&list));
    print!(
        "managed policy for headed mode (sha256 {}):\n{}",
        checks::sha256_text(checks::MANAGED_POLICY),
        checks::MANAGED_POLICY
    );
    if apply && checks::chromium().is_err() {
        let source = checks::playwright_build();
        let target = checks::adopted();
        let matches = checks::sha256_file(&source).as_deref() == Some(checks::PIN_SHA256);
        if !matches {
            eprintln!(
                "pmcp-browser: no local Chromium matches the pin; run the printed download step"
            );
            return 1;
        }
        let dir = target.parent().unwrap_or(Path::new("."));
        let linked =
            std::fs::create_dir_all(dir).and_then(|_| std::os::unix::fs::symlink(&source, &target));
        if let Err(e) = linked {
            eprintln!("pmcp-browser: {}: {e}", target.display());
            return 1;
        }
        println!("adopted {} as {}", source.display(), target.display());
    }
    let unmet = checks().iter().any(|c| c.status == Status::Missing);
    i32::from(unmet)
}

pub fn main() {
    let code = match parse() {
        Err(e) => {
            eprintln!("pmcp-browser: {e}");
            2
        }
        Ok(a) => match a.cmd.as_str() {
            "doctor" => doctor(a.json),
            "setup" => setup(a.apply),
            "serve" => serve(&a).unwrap_or_else(|e| {
                eprintln!("pmcp-browser: {e}");
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
