use std::path::PathBuf;

// Where the daemon listens unless --socket says otherwise, shared by pmcp-pty, pmcp-tui and the
// TS client (src/harness/adapters/pty/client.ts keeps the same order). PMCP_PTY_SOCKET first, so a
// process inside a hosted session reaches its own host; macOS has no XDG_RUNTIME_DIR.
pub const SOCKET_NAME: &str = "pmcp-pty.sock";

pub fn default_socket() -> Option<PathBuf> {
    let var = |k: &str| std::env::var_os(k).filter(|v| !v.is_empty());
    resolve(
        var("PMCP_PTY_SOCKET"),
        var("XDG_RUNTIME_DIR"),
        var("TMPDIR"),
        uid(),
    )
}

fn resolve(
    socket: Option<std::ffi::OsString>,
    runtime: Option<std::ffi::OsString>,
    tmp: Option<std::ffi::OsString>,
    uid: u32,
) -> Option<PathBuf> {
    if let Some(path) = socket {
        return Some(PathBuf::from(path));
    }
    if let Some(dir) = runtime {
        return Some(PathBuf::from(dir).join(SOCKET_NAME));
    }
    // A private directory of the user's own under the per-user TMPDIR macOS sets.
    cfg!(target_os = "macos").then(|| {
        let tmp = tmp.map_or_else(|| PathBuf::from("/tmp"), PathBuf::from);
        tmp.join(format!("pmcp-pty-{uid}")).join(SOCKET_NAME)
    })
}

#[cfg(unix)]
fn uid() -> u32 {
    unsafe { libc::getuid() }
}

#[cfg(not(unix))]
fn uid() -> u32 {
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_socket_comes_from_the_host_then_the_runtime_dir_then_a_private_tmp_dir_on_macos() {
        let os = |s: &str| Some(std::ffi::OsString::from(s));
        let hosted = resolve(os("/run/h.sock"), os("/run/user/7"), None, 7);
        assert_eq!(hosted, Some(PathBuf::from("/run/h.sock")));
        let runtime = resolve(None, os("/run/user/7"), os("/var/t"), 7);
        assert_eq!(runtime, Some(PathBuf::from("/run/user/7/pmcp-pty.sock")));
        let bare = resolve(None, None, os("/var/folders/x/T"), 7);
        let mac = Some(PathBuf::from("/var/folders/x/T/pmcp-pty-7/pmcp-pty.sock"));
        assert_eq!(bare, if cfg!(target_os = "macos") { mac } else { None });
    }
}
