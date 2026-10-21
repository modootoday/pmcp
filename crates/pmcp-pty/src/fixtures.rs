use crate::clock::utc_iso;
use crate::dialog::parse_dialog;
use crate::error::{Code, Fail};
use crate::profile::{Profile, ProfileSet};
use crate::redact::redact;
use crate::session::Session;
use serde_json::{Value, json};
use std::path::Path;
use std::time::SystemTime;

// A fixture is a recorded screen plus what the profile read from it. Replaying fixtures in CI
// turns a runtime upgrade that changes a dialog or busy string into a failing test.
pub struct Report {
    pub lines: Vec<String>,
    pub failed: usize,
}

pub fn expected(profile: &Profile, rows: &[String]) -> Value {
    let text = rows.join("\n");
    let m = profile.observe(&text);
    let dialog = match &m.dialog {
        Some(name) => parse_dialog(profile, rows, name),
        None => Value::Null,
    };
    json!({
        "dialog": m.dialog, "busy": m.busy, "input_empty": m.input_empty,
        "input": profile.draft(&text, &text), "options": dialog["options"], "selected": dialog["selected"],
    })
}

fn valid_label(label: &str) -> bool {
    let ok = |c: char| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-';
    !label.is_empty() && label.len() <= 40 && label.chars().all(ok)
}

fn write(path: &Path, bytes: &[u8]) -> Result<(), Fail> {
    std::fs::write(path, bytes)
        .map_err(|e| Fail::new(Code::BadRequest, format!("write {}: {e}", path.display())))
}

pub fn record(
    root: &Path,
    s: &Session,
    label: &str,
    version: Option<String>,
    masked: bool,
) -> Result<Value, Fail> {
    if !valid_label(label) {
        return Err(Fail::new(
            Code::BadRequest,
            "label must be 1 to 40 of a-z, 0-9 and -",
        ));
    }
    let dir = root.join(&s.profile.name).join(label);
    std::fs::create_dir_all(&dir)
        .map_err(|e| Fail::new(Code::BadRequest, format!("create {}: {e}", dir.display())))?;
    let (rows, raw, size) = {
        let t = s.term();
        let (r, c) = t.parser.screen().size();
        (
            t.rows(),
            t.ring.tail(64 * 1024),
            json!({ "cols": c.get(), "rows": r.get() }),
        )
    };
    let home = std::env::var("HOME").ok();
    let clean = |text: &str| match masked {
        true => redact(text, home.as_deref()),
        false => text.to_string(),
    };
    let rows: Vec<String> = rows.iter().map(|r| clean(r)).collect();
    let raw = clean(&String::from_utf8_lossy(&raw)).into_bytes();
    let expect = expected(&s.profile, &rows);
    let meta = json!({ "profile": s.profile.name, "version": version, "size": size, "redacted": masked, "recorded_at": utc_iso(SystemTime::now()) });
    write(&dir.join("screen.txt"), rows.join("\n").as_bytes())?;
    write(&dir.join("raw.bin"), &raw)?;
    write(&dir.join("expect.json"), format!("{expect:#}\n").as_bytes())?;
    write(&dir.join("meta.json"), format!("{meta:#}\n").as_bytes())?;
    Ok(json!({ "ok": true, "path": dir.display().to_string(), "expect": expect }))
}

// A screen captured from a live run has no expect.json yet; seed writes what the profile reads
// today, for a person to review before it is committed.
fn check_one(
    set: &ProfileSet,
    profile: &str,
    dir: &Path,
    seed: bool,
) -> Result<&'static str, String> {
    let p = set.get(profile).ok_or(format!("no profile {profile}"))?;
    let read =
        |name: &str| std::fs::read_to_string(dir.join(name)).map_err(|e| format!("{name}: {e}"));
    let rows: Vec<String> = read("screen.txt")?.lines().map(String::from).collect();
    let got = expected(&p, &rows);
    let path = dir.join("expect.json");
    if seed && !path.exists() {
        std::fs::write(&path, format!("{got:#}\n")).map_err(|e| e.to_string())?;
        return Ok("seeded");
    }
    let want: Value = serde_json::from_str(&read("expect.json")?).map_err(|e| e.to_string())?;
    match got == want {
        true => Ok("ok"),
        false => Err(format!("want {want} got {got}")),
    }
}

fn entries(dir: &Path) -> Result<Vec<std::path::PathBuf>, String> {
    let list = std::fs::read_dir(dir).map_err(|e| format!("read {}: {e}", dir.display()))?;
    let mut paths: Vec<_> = list
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    paths.sort();
    Ok(paths)
}

pub fn check(set: &ProfileSet, root: &Path, seed: bool) -> Result<Report, String> {
    let mut report = Report {
        lines: Vec::new(),
        failed: 0,
    };
    for profile_dir in entries(root)? {
        let profile = profile_dir
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        for case in entries(&profile_dir)? {
            let name = format!(
                "{profile}/{}",
                case.file_name().unwrap_or_default().to_string_lossy()
            );
            match check_one(set, &profile, &case, seed) {
                Ok(word) => report.lines.push(format!("{word} {name}")),
                Err(why) => {
                    report.failed += 1;
                    report.lines.push(format!("FAIL {name}: {why}"));
                }
            }
        }
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_cannot_leave_the_fixture_tree() {
        assert!(valid_label("tool-confirm-1"));
        for bad in ["", "../x", "a/b", "Upper", &"x".repeat(41)] {
            assert!(!valid_label(bad), "{bad}");
        }
    }
}
