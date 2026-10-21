use sha2::{Digest, Sha256};
use std::path::Path;

// The operator-approved copy `pmcp harness host approve` writes: host.json, policy.json and
// approval.json in an owner-only directory. pmcp-pty and the plugins read access-widening
// settings only from here, and only while the files still match their approval.

/// The digest pmcp writes at approval: one hash over both files, so neither changes alone.
pub fn digest(manifest: &str, policy: &str) -> String {
    let text = format!("host.json\n{manifest}\0policy.json\n{policy}");
    Sha256::digest(text.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

pub fn owned_alone(path: &Path, mask: u32) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let meta = std::fs::metadata(path).map_err(|e| format!("{}: {e}", path.display()))?;
        if meta.uid() != unsafe { libc::geteuid() } || meta.mode() & mask != 0 {
            return Err(format!(
                "{} is not owned by the operator alone",
                path.display()
            ));
        }
    }
    let _ = (path, mask);
    Ok(())
}

fn read(path: &Path) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))
}

/// policy.json's text from an approved directory, or why it may not be used.
pub fn policy_text(dir: &Path) -> Result<String, String> {
    owned_alone(dir, 0o077)?;
    let manifest = read(&dir.join("host.json"))?;
    let policy = read(&dir.join("policy.json"))?;
    let approval: serde_json::Value = serde_json::from_str(&read(&dir.join("approval.json"))?)
        .map_err(|e| format!("approval.json: {e}"))?;
    if approval["sha256"].as_str() != Some(digest(&manifest, &policy).as_str()) {
        return Err(format!("{} does not match its approval", dir.display()));
    }
    Ok(policy)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Pinned in pmcp's host-approve test too, so the two digests cannot drift apart.
    #[test]
    fn the_digest_is_the_one_pmcp_writes() {
        assert_eq!(
            digest("{\"a\":1}\n", "{\"b\":2}\n"),
            "bfa51dc1f537f174494fee2cb4bf5fcb53290f1aa2a39ca5f7ac1ce84eb85ce3"
        );
    }

    #[test]
    fn a_changed_copy_or_a_shared_directory_is_refused() {
        let dir = std::env::temp_dir().join(format!("pmcp-approved-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).unwrap();
        }
        let (manifest, policy) = ("{}\n", "{\"desktop\": {}}\n");
        std::fs::write(dir.join("host.json"), manifest).unwrap();
        std::fs::write(dir.join("policy.json"), policy).unwrap();
        let approval = format!("{{\"sha256\": \"{}\"}}", digest(manifest, policy));
        std::fs::write(dir.join("approval.json"), approval).unwrap();
        assert_eq!(policy_text(&dir).unwrap(), policy);
        std::fs::write(dir.join("policy.json"), "{}\n").unwrap();
        assert!(policy_text(&dir).unwrap_err().contains("does not match"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755)).unwrap();
            assert!(policy_text(&dir).unwrap_err().contains("operator alone"));
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
