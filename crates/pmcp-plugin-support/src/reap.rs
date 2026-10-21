use std::collections::{HashMap, HashSet};
use std::time::Duration;
#[cfg(unix)]
use std::time::Instant;

// Runtimes leave helpers behind (a relaunched node child, MCP servers, a grok leader) that a
// signal to one pid misses. The tree is read from /proc before any signal, because a child
// whose parent died first is reparented and no longer found by walking down from the root.
pub const GRACE: Duration = Duration::from_secs(2);

#[cfg(target_os = "linux")]
fn parents() -> HashMap<u32, Vec<u32>> {
    let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
    let Ok(dir) = std::fs::read_dir("/proc") else {
        return children;
    };
    for entry in dir.flatten() {
        let Ok(pid) = entry.file_name().to_string_lossy().parse::<u32>() else {
            continue;
        };
        let Ok(stat) = std::fs::read_to_string(format!("/proc/{pid}/stat")) else {
            continue;
        };
        let after = stat.rfind(')').map_or("", |i| &stat[i + 2..]);
        if let Some(ppid) = after.split(' ').nth(1).and_then(|p| p.parse().ok()) {
            children.entry(ppid).or_default().push(pid);
        }
    }
    children
}

// macOS has no /proc: libproc lists every pid and gives each one's parent and state.
#[cfg(target_os = "macos")]
fn bsdinfo(pid: u32) -> Option<libc::proc_bsdinfo> {
    let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
    let size = std::mem::size_of::<libc::proc_bsdinfo>() as libc::c_int;
    let ptr = (&mut info as *mut libc::proc_bsdinfo).cast();
    let n = unsafe { libc::proc_pidinfo(pid as libc::c_int, libc::PROC_PIDTBSDINFO, 0, ptr, size) };
    (n == size).then_some(info)
}

#[cfg(target_os = "macos")]
fn parents() -> HashMap<u32, Vec<u32>> {
    let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
    let count = unsafe { libc::proc_listallpids(std::ptr::null_mut(), 0) }.max(0) as usize;
    // Room for processes started between the count and the listing.
    let mut pids = vec![0 as libc::pid_t; count + 64];
    let bytes = (pids.len() * std::mem::size_of::<libc::pid_t>()) as libc::c_int;
    let n = unsafe { libc::proc_listallpids(pids.as_mut_ptr().cast(), bytes) }.max(0) as usize;
    for &pid in pids.iter().take(n).filter(|&&p| p > 0) {
        if let Some(info) = bsdinfo(pid as u32) {
            children.entry(info.pbi_ppid).or_default().push(pid as u32);
        }
    }
    children
}

// Other systems never get here: every entry point refuses them first (platform::require).
#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn parents() -> HashMap<u32, Vec<u32>> {
    unimplemented!("process trees are read on Linux and macOS only")
}

/// The root and every process below it, by parent links, as the system shows them now.
pub fn tree(root: u32) -> Vec<u32> {
    let children = parents();
    let mut seen = HashSet::from([root]);
    let mut queue = vec![root];
    while let Some(pid) = queue.pop() {
        for &child in children.get(&pid).into_iter().flatten() {
            if seen.insert(child) {
                queue.push(child);
            }
        }
    }
    seen.into_iter().collect()
}

#[cfg(unix)]
pub fn alive(pid: u32) -> bool {
    unsafe { libc::kill(pid as libc::pid_t, 0) == 0 }
}

// A zombie answers kill 0 but runs nothing; its parent or init reaps it.
#[cfg(target_os = "linux")]
fn zombie(pid: u32) -> bool {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).unwrap_or_default();
    let state = stat.rfind(')').and_then(|i| stat.get(i + 2..i + 3));
    state == Some("Z")
}

#[cfg(target_os = "macos")]
fn zombie(pid: u32) -> bool {
    bsdinfo(pid).is_some_and(|info| info.pbi_status == libc::SZOMB)
}

#[cfg(all(unix, not(any(target_os = "linux", target_os = "macos"))))]
fn zombie(_pid: u32) -> bool {
    false
}

#[cfg(unix)]
fn gone(pid: u32) -> bool {
    !alive(pid) || zombie(pid)
}

#[cfg(unix)]
fn wait_gone(pids: &[u32], limit: Duration) {
    let end = Instant::now() + limit;
    while Instant::now() < end && pids.iter().any(|&p| !gone(p)) {
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[cfg(unix)]
fn send(roots: &[u32], pids: &[u32], sig: libc::c_int) {
    for &root in roots {
        unsafe { libc::kill(-(root as libc::pid_t), sig) };
    }
    for &pid in pids {
        unsafe { libc::kill(pid as libc::pid_t, sig) };
    }
}

#[cfg(unix)]
pub fn signal_number(name: &str) -> Result<libc::c_int, String> {
    match name {
        "HUP" => Ok(libc::SIGHUP),
        "INT" => Ok(libc::SIGINT),
        "TERM" => Ok(libc::SIGTERM),
        "KILL" => Ok(libc::SIGKILL),
        other => Err(format!("unsupported signal {other}")),
    }
}

/// One signal to each session's process group and to every process in its tree.
#[cfg(unix)]
pub fn signal(roots: &[u32], sig: libc::c_int) -> Vec<u32> {
    let pids: Vec<u32> = roots.iter().flat_map(|&r| tree(r)).collect();
    send(roots, &pids, sig);
    pids
}

/// SIGHUP to the trees, then SIGKILL to whatever is still alive after the grace period, and
/// returns only when all of it is gone: live, a shutdown returned while a leader was still up.
#[cfg(unix)]
pub fn terminate(roots: &[u32], grace: Duration) {
    let mut pids = signal(roots, libc::SIGHUP);
    wait_gone(&pids, grace);
    // A child started during the grace (a relaunched node, a helper) is found again before KILL.
    let fresh: Vec<u32> = pids
        .iter()
        .filter(|&&p| !gone(p))
        .flat_map(|&p| tree(p))
        .collect();
    pids.extend(fresh);
    pids.sort_unstable();
    pids.dedup();
    let left: Vec<u32> = pids.into_iter().filter(|&p| !gone(p)).collect();
    send(roots, &left, libc::SIGKILL);
    wait_gone(&left, GRACE);
}

/// A named signal goes to the whole tree once; no name stops it in the background, ending
/// with KILL for whatever outlives the grace period.
#[cfg(unix)]
pub fn stop(pid: u32, name: Option<&str>) -> Result<(), String> {
    match name {
        Some(name) => drop(signal(&[pid], signal_number(name)?)),
        None => drop(std::thread::spawn(move || terminate(&[pid], GRACE))),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_tree_holds_the_root_and_its_children() {
        let mut child = std::process::Command::new("sleep")
            .arg("5")
            .spawn()
            .unwrap();
        let mine = tree(std::process::id());
        assert!(mine.contains(&std::process::id()));
        assert!(mine.contains(&child.id()));
        let _ = child.kill();
        let _ = child.wait();
    }
}
