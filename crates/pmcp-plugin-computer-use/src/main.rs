// pmcp-desktop runs on Linux; elsewhere it builds as a binary that says so and exits.
#[cfg(unix)]
mod cli;

fn main() {
    #[cfg(unix)]
    cli::main();
    #[cfg(not(unix))]
    {
        let why = pmcp_plugin_support::platform::plugins_unsupported().unwrap_or_default();
        eprintln!("pmcp-desktop: {why}");
        std::process::exit(2);
    }
}
