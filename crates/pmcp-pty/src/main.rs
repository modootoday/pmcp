use pmcp_pty::paths::default_socket;
use pmcp_pty::{attach, client, daemon, fixtures, profile};
use std::path::PathBuf;

const USAGE: &str = "usage:
  pmcp-pty daemon [--socket <path>] [--profiles <file.toml>] [--fixtures <dir>] [--host <approval dir> | --answers <file.toml>]
  pmcp-pty attach <name|id> [--socket <path>] [--read-only | --lease <token>]
  pmcp-pty call [--socket <path>] '<json request>'
  pmcp-pty profiles [--profiles <file.toml>] [--check <fixtures dir> [--seed]]
The socket defaults to PMCP_PTY_SOCKET, then $XDG_RUNTIME_DIR/pmcp-pty.sock, then on macOS
$TMPDIR/pmcp-pty-<uid>/pmcp-pty.sock. Linux and macOS only.";

#[derive(Default)]
struct Args {
    positional: Vec<String>,
    socket: Option<PathBuf>,
    profiles: Option<PathBuf>,
    fixtures: Option<PathBuf>,
    answers: Option<PathBuf>,
    host: Option<PathBuf>,
    check: Option<PathBuf>,
    read_only: bool,
    lease: Option<String>,
    seed: bool,
}

fn parse_args(raw: Vec<String>) -> Result<Args, String> {
    let mut args = Args::default();
    let mut it = raw.into_iter();
    while let Some(a) = it.next() {
        let mut path = |flag: &str| {
            it.next()
                .map(PathBuf::from)
                .ok_or(format!("{flag} needs a path"))
        };
        match a.as_str() {
            "--socket" => args.socket = Some(path("--socket")?),
            "--profiles" => args.profiles = Some(path("--profiles")?),
            "--fixtures" => args.fixtures = Some(path("--fixtures")?),
            "--answers" => args.answers = Some(path("--answers")?),
            "--host" => args.host = Some(path("--host")?),
            "--check" => args.check = Some(path("--check")?),
            "--read-only" => args.read_only = true,
            "--lease" => args.lease = Some(it.next().ok_or("--lease needs a token")?),
            "--seed" => args.seed = true,
            _ => args.positional.push(a),
        }
    }
    Ok(args)
}

fn load_profiles(path: Option<&PathBuf>) -> Result<profile::ProfileSet, String> {
    let env_path = std::env::var_os("PMCP_PTY_PROFILES").map(PathBuf::from);
    let Some(path) = path.or(env_path.as_ref()) else {
        return profile::ProfileSet::parse(profile::BUILTIN);
    };
    let text =
        std::fs::read_to_string(path).map_err(|e| format!("read {}: {e}", path.display()))?;
    profile::ProfileSet::parse(&text)
}

fn run() -> Result<(), String> {
    let args = parse_args(std::env::args().skip(1).collect())?;
    let cmd = args.positional.first().map(String::as_str).unwrap_or("");
    let socket = || {
        args.socket
            .clone()
            .or_else(default_socket)
            .ok_or_else(|| format!("no socket: pass --socket or set XDG_RUNTIME_DIR\n{USAGE}"))
    };
    match cmd {
        "daemon" => daemon::run(
            &socket()?,
            load_profiles(args.profiles.as_ref())?,
            daemon::Config {
                fixtures: args.fixtures.clone(),
                policy: daemon::PolicySource {
                    host: args.host.clone(),
                    answers: args.answers.clone(),
                },
            },
        ),
        "attach" => {
            let target = args.positional.get(1).ok_or(USAGE)?;
            attach::run(&socket()?, target, args.read_only, args.lease.clone())
        }
        "call" => {
            let request = args.positional.get(1).ok_or(USAGE)?;
            client::call(&socket()?, request)
        }
        "profiles" => {
            let set = load_profiles(args.profiles.as_ref())?;
            let Some(dir) = &args.check else {
                println!("profiles ok");
                return Ok(());
            };
            let report = fixtures::check(&set, dir, args.seed)?;
            println!("{}", report.lines.join("\n"));
            match report.failed {
                0 => Ok(()),
                n => Err(format!("{n} fixture(s) do not match their profile")),
            }
        }
        _ => Err(USAGE.to_string()),
    }
}

fn main() {
    if let Err(e) = pmcp_pty::platform::require("pmcp-pty") {
        eprintln!("{e}");
        std::process::exit(2);
    }
    if let Err(e) = run() {
        eprintln!("pmcp-pty: {e}");
        std::process::exit(2);
    }
}
