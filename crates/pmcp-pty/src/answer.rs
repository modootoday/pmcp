use super::Daemon;
use crate::dialog::parse_dialog;
use crate::error::{Code, Fail};
use crate::input::encode_key;
use crate::observe::snapshot;
use crate::policy::{Policy, load};
use crate::proto::AnswerReq;
use serde_json::{Value, json};

// Login, auth and trust prompts belong to the person at the keyboard: no policy file can allow
// pmcp-pty to answer them, whatever it says.
fn never(dialog: &str) -> bool {
    dialog.starts_with("auth-") || dialog.contains("trust") || dialog == "hooks-review"
}

fn allowed(policy: &Policy, profile: &str, dialog: &str, option: &Value) -> bool {
    let key = option["key"].as_str().unwrap_or_default();
    let label = option["label"].as_str().unwrap_or_default();
    policy.allow.iter().any(|r| {
        r.profile == profile
            && r.dialog == dialog
            && r.options.iter().any(|o| o == key || o == label)
    })
}

// Numbers and letters choose directly; a marked list without keys moves the mark, then Enter.
fn keys(select: &str, selected: Option<&str>, key: &str) -> Vec<String> {
    if select != "arrows" {
        return vec![key.to_string()];
    }
    let to: i64 = key.parse().unwrap_or(1);
    let from: i64 = selected.and_then(|s| s.parse().ok()).unwrap_or(1);
    let step = if to < from { "Up" } else { "Down" };
    let mut out = vec![step.to_string(); (to - from).unsigned_abs() as usize];
    out.push("Enter".into());
    out
}

fn deny(message: String) -> Fail {
    Fail::new(Code::Guard, message)
}

impl Daemon {
    // Read like the answer rules, on every request: an operator edit applies without a restart.
    pub(super) fn policy_state(&self) -> Value {
        match load(&self.policy) {
            Ok((p, from)) => {
                json!({ "loaded": true, "from": from, "answers": p.allow.len(), "mcp_write": p.mcp_write })
            }
            Err(why) => json!({ "loaded": false, "reason": why, "mcp_write": false }),
        }
    }

    pub(super) fn answer_op(&self, r: AnswerReq) -> Result<Value, Fail> {
        let s = self.input_target(&r.id, r.expect.as_ref())?;
        if never(&r.dialog) {
            return Err(deny(format!("{} is never answered by pmcp-pty", r.dialog)));
        }
        let mut t = s.settle();
        let snap = snapshot(&s, &mut t);
        let shown = snap.matched.dialog.clone().unwrap_or_default();
        if shown != r.dialog {
            return Err(Fail::new(
                Code::Conflict,
                format!("the dialog on screen is {shown:?}"),
            ));
        }
        let dialog = parse_dialog(&s.profile, &t.rows(), &shown);
        let options = dialog["options"].as_array().cloned().unwrap_or_default();
        let wanted = |o: &&Value| o["key"] == json!(r.option) || o["label"] == json!(r.option);
        let Some(option) = options.iter().find(wanted).cloned() else {
            return Err(Fail::new(
                Code::BadRequest,
                format!("no option {:?} in {shown}", r.option),
            ));
        };
        let (policy, _) = load(&self.policy).map_err(deny)?;
        if !allowed(&policy, &s.profile.name, &shown, &option) {
            return Err(deny(format!(
                "the answer policy does not allow {shown} {}",
                option["key"]
            )));
        }
        let app_cursor = t.parser.screen().application_cursor();
        let select = dialog["select"].as_str().unwrap_or("number");
        let key = option["key"].as_str().unwrap_or_default();
        let mut bytes = Vec::new();
        for k in keys(select, dialog["selected"].as_str(), key) {
            bytes.extend(encode_key(&k, app_cursor).map_err(|e| Fail::new(Code::BadRequest, e))?);
        }
        drop(t);
        s.write_raw(&bytes)
            .map_err(|e| Fail::new(Code::Exited, e))?;
        Ok(json!({ "ok": true, "allowed": true, "dialog": shown, "option": option }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_and_trust_are_never_answered_and_arrows_walk_to_the_option() {
        assert!(never("auth-login") && never("folder-trust") && never("hooks-review"));
        assert!(!never("tool-approval"));
        let policy: Policy = toml::from_str(
            "[[allow]]\nprofile = \"gemini\"\ndialog = \"tool-approval\"\noptions = [\"Allow once\"]",
        )
        .unwrap();
        let once = json!({ "key": "1", "label": "Allow once" });
        let always = json!({ "key": "2", "label": "Allow always" });
        assert!(allowed(&policy, "gemini", "tool-approval", &once));
        assert!(!allowed(&policy, "gemini", "tool-approval", &always));
        assert!(!allowed(&policy, "codex", "tool-approval", &once));
        assert!(!allowed(
            &Policy::default(),
            "gemini",
            "tool-approval",
            &once
        ));
        assert_eq!(keys("number", None, "2"), ["2"]);
        assert_eq!(keys("arrows", Some("1"), "3"), ["Down", "Down", "Enter"]);
        assert_eq!(keys("arrows", Some("2"), "1"), ["Up", "Enter"]);
    }
}
