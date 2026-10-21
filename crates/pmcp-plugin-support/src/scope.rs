use std::process::{Command, Stdio};

// A browser or desktop tree runs in one transient systemd scope, so its memory and task caps hold
// for every child it forks. systemd-run --scope runs the command as our own child, so the /proc
// tree reap still finds it.
pub struct Limits {
    pub memory_max: String,
    pub tasks_max: u32,
}

/// Bytes from a systemd size such as 512M or 2G.
pub fn bytes(size: &str) -> Result<u64, String> {
    let (number, unit) = size.split_at(size.trim_end_matches(char::is_alphabetic).len());
    let n: u64 = number.parse().map_err(|_| format!("bad size {size}"))?;
    let scale: u64 = match unit {
        "" => 1,
        "K" => 1 << 10,
        "M" => 1 << 20,
        "G" => 1 << 30,
        _ => return Err(format!("bad size unit in {size}; use K, M or G")),
    };
    n.checked_mul(scale)
        .ok_or_else(|| format!("size {size} is too large"))
}

// MemoryHigh at 80% throttles before MemoryMax kills; with swap off the kill stays in the scope.
pub fn memory_high(memory_max: &str) -> Result<u64, String> {
    Ok(bytes(memory_max)? / 5 * 4)
}

// Memory caps are systemd scopes, so Linux only; macOS has no equivalent and runs uncapped,
// which its doctor row and a line on stderr at start say.
pub const CAPS: bool = cfg!(target_os = "linux");

pub fn available() -> bool {
    CAPS && Command::new("systemd-run")
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

/// The user manager's address when the environment lacks it: Codex starts MCP servers with an
/// allowlist that drops XDG_RUNTIME_DIR and DBUS_SESSION_BUS_ADDRESS, and without them
/// systemd-run --user cannot reach the manager. Only the standard /run/user/<uid> is used.
#[cfg(not(unix))]
pub fn user_bus_env() -> Vec<(String, String)> {
    Vec::new()
}

#[cfg(unix)]
pub fn user_bus_env() -> Vec<(String, String)> {
    let mut out = Vec::new();
    let uid = unsafe { libc::getuid() };
    let runtime = std::env::var("XDG_RUNTIME_DIR").unwrap_or_else(|_| format!("/run/user/{uid}"));
    if std::env::var_os("XDG_RUNTIME_DIR").is_none() && std::path::Path::new(&runtime).is_dir() {
        out.push(("XDG_RUNTIME_DIR".into(), runtime.clone()));
    }
    let bus = format!("{runtime}/bus");
    if std::env::var_os("DBUS_SESSION_BUS_ADDRESS").is_none() && std::path::Path::new(&bus).exists()
    {
        out.push((
            "DBUS_SESSION_BUS_ADDRESS".into(),
            format!("unix:path={bus}"),
        ));
    }
    out
}

/// Whether a capped scope can be created here, by creating one that runs true.
pub fn check(limits: &Limits) -> Result<(), String> {
    let argv = ["true".to_string()];
    let unit = format!("pmcp-plugin-check-{}", std::process::id());
    let out = scoped(&unit, limits, &argv)?
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("systemd-run: {e}"))?;
    match out.status.success() {
        true => Ok(()),
        false => Err(String::from_utf8_lossy(&out.stderr).trim().to_string()),
    }
}

/// The command that runs argv in a capped transient scope named unit.
pub fn scoped(unit: &str, limits: &Limits, argv: &[String]) -> Result<Command, String> {
    let (program, args) = argv.split_first().ok_or("empty argv")?;
    let mut cmd = Command::new("systemd-run");
    cmd.envs(user_bus_env());
    cmd.args(["--user", "--scope", "--collect", "--quiet"])
        .arg(format!("--unit={unit}"))
        .arg("-p")
        .arg(format!("MemoryMax={}", limits.memory_max))
        .arg("-p")
        .arg(format!("MemoryHigh={}", memory_high(&limits.memory_max)?))
        .arg("-p")
        .arg(format!("TasksMax={}", limits.tasks_max))
        .arg("--")
        .arg(program)
        .args(args);
    Ok(cmd)
}

pub const SCOPED_ENV: &str = "PMCP_PLUGIN_SCOPED";

// A plugin re-runs itself once inside its scope, so everything it starts later (Xvfb, Chromium,
// launched apps) is capped with it; stdio passes through, so MCP still talks to the child.
pub fn reexec_scoped(unit: &str, limits: &Limits) -> Result<Option<i32>, String> {
    if std::env::var_os(SCOPED_ENV).is_some() {
        return Ok(None);
    }
    if !CAPS {
        eprintln!("{unit}: no memory caps on this system; running uncapped");
        return Ok(None);
    }
    if !available() {
        return Err(
            "systemd-run is missing; run with --no-scope to start without memory caps".into(),
        );
    }
    check(limits).map_err(|why| format!("no memory-capped scope: {why}"))?;
    let me = std::env::current_exe().map_err(|e| e.to_string())?;
    let mut argv = vec![me.display().to_string()];
    argv.extend(std::env::args().skip(1));
    let status = scoped(unit, limits, &argv)?
        .env(SCOPED_ENV, unit)
        .status()
        .map_err(|e| format!("systemd-run: {e}"))?;
    Ok(Some(status.code().unwrap_or(1)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes_parse_and_the_scope_carries_every_cap() {
        assert_eq!(bytes("512M").unwrap(), 512 << 20);
        assert_eq!(memory_high("2G").unwrap(), (2u64 << 30) / 5 * 4);
        assert!(bytes("2T").is_err() && bytes("G").is_err());
        let limits = Limits {
            memory_max: "2G".into(),
            tasks_max: 512,
        };
        let argv = ["chromium".to_string(), "--headless".to_string()];
        let cmd = scoped("pmcp-browser-1", &limits, &argv).unwrap();
        let args: Vec<String> = cmd.get_args().map(|a| a.to_string_lossy().into()).collect();
        assert_eq!(cmd.get_program(), "systemd-run");
        assert!(args.contains(&"--unit=pmcp-browser-1".to_string()));
        assert!(
            args.contains(&"MemoryMax=2G".to_string())
                && args.contains(&"TasksMax=512".to_string())
        );
        assert_eq!(&args[args.len() - 3..], ["--", "chromium", "--headless"]);
    }
}
