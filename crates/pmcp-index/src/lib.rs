use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct IndexedSkill {
    pub path: String,
    pub sha256: String,
    pub bytes: usize,
    pub lines: usize,
    pub est_tokens: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct IndexManifest {
    pub entries: BTreeMap<String, IndexedSkill>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct IncrementalStats {
    pub total: usize,
    pub reused: usize,
    pub updated: usize,
    pub removed: usize,
    pub total_bytes: usize,
    pub total_est_tokens: usize,
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    let mut out = String::with_capacity(64);
    for b in digest {
        out.push_str(&format!("{b:02x}"));
    }
    out
}

// Conservative 4-byte-per-token estimate for mixed ASCII/UTF-8 prompt budgeting.
pub fn estimate_tokens(text: &str) -> usize {
    text.len().div_ceil(4)
}

pub fn scan_incremental(
    paths: &[String],
    previous: &IndexManifest,
) -> (IndexManifest, IncrementalStats) {
    let mut next = IndexManifest::default();
    let mut reused = 0usize;
    let mut updated = 0usize;

    for rel in paths {
        let Ok(raw) = fs::read(Path::new(rel)) else {
            continue;
        };
        let hash = sha256_hex(&raw);
        if let Some(prev) = previous.entries.get(rel)
            && prev.sha256 == hash
        {
            reused += 1;
            next.entries.insert(rel.clone(), prev.clone());
            continue;
        }
        let text = String::from_utf8_lossy(&raw);
        let entry = IndexedSkill {
            path: rel.clone(),
            sha256: hash,
            bytes: raw.len(),
            lines: text.lines().count(),
            est_tokens: estimate_tokens(&text),
        };
        updated += 1;
        next.entries.insert(rel.clone(), entry);
    }

    let removed = previous
        .entries
        .keys()
        .filter(|k| !next.entries.contains_key(*k))
        .count();
    let total_bytes = next.entries.values().map(|e| e.bytes).sum();
    let total_est_tokens = next.entries.values().map(|e| e.est_tokens).sum();
    let stats = IncrementalStats {
        total: next.entries.len(),
        reused,
        updated,
        removed,
        total_bytes,
        total_est_tokens,
    };
    (next, stats)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn tmp_file(name: &str, body: &str) -> String {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("pmcp-index-test-{stamp}"));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join(name);
        fs::write(&file, body).unwrap();
        file.to_string_lossy().into_owned()
    }

    #[test]
    fn reuses_unchanged_hashes_and_updates_modified_entries() {
        let a = tmp_file("SKILL-a.md", "# Skill A\nline 2\n");
        let b = tmp_file("SKILL-b.md", "# Skill B\nline 2\n");
        let (m1, s1) = scan_incremental(&[a.clone(), b.clone()], &IndexManifest::default());
        assert_eq!(s1.total, 2);
        assert_eq!(s1.updated, 2);
        assert_eq!(s1.reused, 0);

        fs::write(&b, "# Skill B updated\nmore context\n").unwrap();
        let (m2, s2) = scan_incremental(&[a.clone(), b.clone()], &m1);
        assert_eq!(s2.total, 2);
        assert_eq!(s2.reused, 1);
        assert_eq!(s2.updated, 1);
        assert_eq!(s2.removed, 0);
        assert!(s2.total_est_tokens > 0);

        let (_, s3) = scan_incremental(std::slice::from_ref(&a), &m2);
        assert_eq!(s3.total, 1);
        assert_eq!(s3.reused, 1);
        assert_eq!(s3.removed, 1);

        let _ = fs::remove_dir_all(Path::new(&a).parent().unwrap());
        let _ = fs::remove_dir_all(Path::new(&b).parent().unwrap());
    }
}
