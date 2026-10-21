use std::fs::{File, OpenOptions};
use std::os::fd::AsRawFd;
use std::os::unix::fs::OpenOptionsExt;
use std::path::Path;

// At most two browsers on the host at once: each pmcp-browser process holds one of two slot
// files under an exclusive flock for as long as it runs; the kernel drops it when the process ends.
pub const SLOTS: usize = 2;

pub struct Slot {
    pub index: usize,
    _file: File,
}

pub fn take_slot(dir: &Path) -> Result<Slot, String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let mut holders = Vec::new();
    for index in 1..=SLOTS {
        let path = dir.join(format!("slot-{index}.lock"));
        let mut file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .mode(0o600)
            .open(&path)
            .map_err(|e| format!("{}: {e}", path.display()))?;
        let got = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } == 0;
        if got {
            use std::io::{Seek, Write};
            let _ = file.set_len(0);
            let _ = file.rewind();
            let _ = write!(file, "{}", std::process::id());
            return Ok(Slot { index, _file: file });
        }
        holders.push(std::fs::read_to_string(&path).unwrap_or_default());
    }
    Err(format!(
        "both browser slots are taken (pids {}); close another pmcp-browser first",
        holders.join(", ")
    ))
}

/// Bytes under dir, files only, one level deep: where Chromium puts downloads.
pub fn used(dir: &Path) -> u64 {
    std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .filter_map(|e| e.metadata().ok())
                .filter(|m| m.is_file())
                .map(|m| m.len())
                .sum()
        })
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_third_holder_is_refused_and_a_released_slot_is_reused() {
        let dir = std::env::temp_dir().join(format!("pmcp-browser-slots-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let a = take_slot(&dir).unwrap();
        let b = take_slot(&dir).unwrap();
        assert_eq!((a.index, b.index), (1, 2));
        let third = take_slot(&dir).err().unwrap_or_default();
        assert!(third.contains("both browser slots are taken"), "{third}");
        drop(a);
        assert_eq!(take_slot(&dir).unwrap().index, 1);
        std::fs::write(dir.join("d.bin"), vec![0u8; 1000]).unwrap();
        assert!(used(&dir) >= 1000);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
