use std::path::Path;

#[cfg(unix)]
pub use std::os::unix::net::{UnixListener, UnixStream};
#[cfg(windows)]
pub use uds_windows::{UnixListener, UnixStream};

/// Binds the socket owner-only; a live daemon on the same path is an error, a stale file is replaced.
pub fn bind(path: &Path) -> Result<UnixListener, String> {
    if path.exists() {
        if UnixStream::connect(path).is_ok() {
            return Err(format!(
                "a daemon is already listening on {}",
                path.display()
            ));
        }
        refuse_non_socket(path)?;
        std::fs::remove_file(path).map_err(|e| format!("remove stale socket: {e}"))?;
    }
    // A missing parent (the macOS default under TMPDIR) is created for the owner alone.
    if let Some(dir) = path
        .parent()
        .filter(|d| !d.as_os_str().is_empty() && !d.exists())
    {
        std::fs::create_dir_all(dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::Permissions::from_mode(0o700);
            std::fs::set_permissions(dir, mode)
                .map_err(|e| format!("chmod {}: {e}", dir.display()))?;
        }
    }
    let listener = bind_owner_only(path)?;
    restrict(path)?;
    Ok(listener)
}

#[cfg(unix)]
fn refuse_non_socket(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::FileTypeExt;
    let meta = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !meta.file_type().is_socket() {
        return Err(format!("{} exists and is not a socket", path.display()));
    }
    Ok(())
}

#[cfg(windows)]
fn refuse_non_socket(_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(unix)]
fn bind_owner_only(path: &Path) -> Result<UnixListener, String> {
    let old = unsafe { libc::umask(0o177) };
    let result = UnixListener::bind(path);
    unsafe { libc::umask(old) };
    result.map_err(|e| format!("bind {}: {e}", path.display()))
}

#[cfg(windows)]
fn bind_owner_only(path: &Path) -> Result<UnixListener, String> {
    UnixListener::bind(path).map_err(|e| format!("bind {}: {e}", path.display()))
}

#[cfg(unix)]
fn restrict(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
        .map_err(|e| format!("chmod socket: {e}"))
}

#[cfg(windows)]
fn restrict(_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "linux")]
fn peer_uid(stream: &UnixStream) -> Result<u32, String> {
    use std::os::fd::AsRawFd;
    let mut cred = libc::ucred {
        pid: 0,
        uid: 0,
        gid: 0,
    };
    let mut len = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
    let ptr = (&mut cred as *mut libc::ucred).cast();
    let rc = unsafe {
        libc::getsockopt(
            stream.as_raw_fd(),
            libc::SOL_SOCKET,
            libc::SO_PEERCRED,
            ptr,
            &mut len,
        )
    };
    if rc != 0 {
        return Err(format!("SO_PEERCRED: {}", std::io::Error::last_os_error()));
    }
    Ok(cred.uid)
}

/// The connecting process, for the attachers list and the audit log.
#[cfg(target_os = "linux")]
pub fn peer_pid(stream: &UnixStream) -> Option<u32> {
    use std::os::fd::AsRawFd;
    let mut cred = libc::ucred {
        pid: 0,
        uid: 0,
        gid: 0,
    };
    let mut len = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
    let ptr = (&mut cred as *mut libc::ucred).cast();
    let rc = unsafe {
        libc::getsockopt(
            stream.as_raw_fd(),
            libc::SOL_SOCKET,
            libc::SO_PEERCRED,
            ptr,
            &mut len,
        )
    };
    (rc == 0 && cred.pid > 0).then_some(cred.pid as u32)
}

// macOS reports the peer's pid through LOCAL_PEERPID on the local socket level.
#[cfg(target_os = "macos")]
pub fn peer_pid(stream: &UnixStream) -> Option<u32> {
    use std::os::fd::AsRawFd;
    let mut pid: libc::pid_t = 0;
    let mut len = std::mem::size_of::<libc::pid_t>() as libc::socklen_t;
    let ptr = (&mut pid as *mut libc::pid_t).cast();
    let rc = unsafe {
        libc::getsockopt(
            stream.as_raw_fd(),
            libc::SOL_LOCAL,
            libc::LOCAL_PEERPID,
            ptr,
            &mut len,
        )
    };
    (rc == 0 && pid > 0).then_some(pid as u32)
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
pub fn peer_pid(_stream: &UnixStream) -> Option<u32> {
    None
}

#[cfg(all(unix, not(target_os = "linux")))]
fn peer_uid(stream: &UnixStream) -> Result<u32, String> {
    use std::os::fd::AsRawFd;
    let mut uid: libc::uid_t = 0;
    let mut gid: libc::gid_t = 0;
    let rc = unsafe { libc::getpeereid(stream.as_raw_fd(), &mut uid, &mut gid) };
    if rc != 0 {
        return Err(format!("getpeereid: {}", std::io::Error::last_os_error()));
    }
    Ok(uid)
}

#[cfg(unix)]
pub fn check_peer(stream: &UnixStream) -> Result<(), String> {
    let me = unsafe { libc::geteuid() };
    let peer = peer_uid(stream)?;
    if peer != me {
        return Err(format!("peer uid {peer} is not the daemon owner"));
    }
    Ok(())
}

/// Windows has no peer credentials on AF_UNIX; access rests on the ACL of the socket directory.
#[cfg(windows)]
pub fn check_peer(_stream: &UnixStream) -> Result<(), String> {
    Ok(())
}
