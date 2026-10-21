use regex::Regex;
use serde::Deserialize;
use std::collections::BTreeMap;
use std::sync::Arc;

pub const BUILTIN: &str = include_str!("../profiles.toml");

#[derive(Deserialize)]
struct FileSpec {
    profiles: BTreeMap<String, ProfileSpec>,
}

#[derive(Deserialize)]
struct ProfileSpec {
    #[serde(default)]
    argv0: Vec<String>,
    #[serde(default = "default_idle_ms")]
    idle_ms: u64,
    #[serde(default = "default_submit_delay_ms")]
    submit_delay_ms: u64,
    #[serde(default = "default_settle_ms")]
    settle_ms: u64,
    #[serde(default)]
    dialogs: Vec<PatternSpec>,
    #[serde(default)]
    busy: Vec<PatternSpec>,
    #[serde(default)]
    authenticating: Vec<PatternSpec>,
    #[serde(default)]
    input_empty: Vec<PatternSpec>,
    #[serde(default)]
    spinner: Vec<PatternSpec>,
    #[serde(default)]
    input: Option<PatternSpec>,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    delivery: Option<String>,
}

#[derive(Deserialize)]
struct PatternSpec {
    name: String,
    regex: String,
    #[serde(default)]
    source: Option<String>,
}

fn default_idle_ms() -> u64 {
    1500
}

fn default_submit_delay_ms() -> u64 {
    80
}

fn default_settle_ms() -> u64 {
    400
}

pub struct Pattern {
    pub name: String,
    pub source: Option<String>,
    regex: Regex,
}

pub struct Profile {
    pub name: String,
    pub argv0: Vec<String>,
    pub idle_ms: u64,
    pub submit_delay_ms: u64,
    pub settle_ms: u64,
    // The runtime version the patterns were read from, and the turn delivery channel to try first.
    pub version: Option<String>,
    pub delivery: Option<String>,
    dialogs: Vec<Pattern>,
    busy: Vec<Pattern>,
    // A runtime signing in with nothing to choose (gemini's auth spinner): a state to wait out,
    // not a question for a person.
    authenticating: Vec<Pattern>,
    input_empty: Vec<Pattern>,
    spinner: Vec<Pattern>,
    input: Option<Pattern>,
}

#[derive(Debug, Default, PartialEq)]
pub struct ScreenMatch {
    pub dialog: Option<String>,
    pub dialog_source: Option<String>,
    pub busy: Option<String>,
    pub authenticating: Option<String>,
    pub input_empty: Option<bool>,
}

fn first_match<'a>(patterns: &'a [Pattern], text: &str) -> Option<&'a Pattern> {
    patterns.iter().find(|p| p.regex.is_match(text))
}

impl Profile {
    fn fallback() -> Profile {
        Profile {
            name: "default".into(),
            argv0: Vec::new(),
            idle_ms: default_idle_ms(),
            submit_delay_ms: default_submit_delay_ms(),
            settle_ms: default_settle_ms(),
            version: None,
            delivery: None,
            dialogs: Vec::new(),
            busy: Vec::new(),
            authenticating: Vec::new(),
            input_empty: Vec::new(),
            spinner: Vec::new(),
            input: None,
        }
    }

    pub fn observe(&self, screen_text: &str) -> ScreenMatch {
        let dialog = first_match(&self.dialogs, screen_text);
        let busy = first_match(&self.busy, screen_text);
        let authenticating = first_match(&self.authenticating, screen_text);
        let input_empty = match self.input_empty.is_empty() {
            true => None,
            false => Some(first_match(&self.input_empty, screen_text).is_some()),
        };
        ScreenMatch {
            dialog: dialog.map(|p| p.name.clone()),
            dialog_source: dialog.and_then(|p| p.source.clone()),
            busy: busy.map(|p| p.name.clone()),
            authenticating: authenticating.map(|p| p.name.clone()),
            input_empty,
        }
    }

    // Spinner frames, busy status rows and the live input box are redrawn constantly, so they
    // never belong in a transcript.
    pub fn is_chrome(&self, row: &str) -> bool {
        let input = self.input.as_ref().is_some_and(|p| p.regex.is_match(row));
        input
            || first_match(&self.spinner, row).is_some()
            || first_match(&self.busy, row).is_some()
            || first_match(&self.authenticating, row).is_some()
            || first_match(&self.input_empty, row).is_some()
    }

    pub fn dialog_line<'a>(&self, screen_text: &'a str) -> Option<&'a str> {
        let pattern = first_match(&self.dialogs, screen_text)?;
        screen_text
            .lines()
            .find(|line| pattern.regex.is_match(line))
    }
}

fn compile_one(p: PatternSpec, profile: &str) -> Result<Pattern, String> {
    let regex =
        Regex::new(&p.regex).map_err(|e| format!("profile {profile} pattern {}: {e}", p.name))?;
    Ok(Pattern {
        name: p.name,
        source: p.source,
        regex,
    })
}

fn compile(list: Vec<PatternSpec>, profile: &str) -> Result<Vec<Pattern>, String> {
    list.into_iter().map(|p| compile_one(p, profile)).collect()
}

pub struct ProfileSet {
    profiles: Vec<Arc<Profile>>,
}

impl ProfileSet {
    pub fn parse(text: &str) -> Result<ProfileSet, String> {
        let spec: FileSpec = toml::from_str(text).map_err(|e| format!("profiles: {e}"))?;
        let mut profiles = Vec::new();
        for (name, p) in spec.profiles {
            let input = match p.input {
                Some(i) => Some(compile_one(i, &name)?),
                None => None,
            };
            profiles.push(Arc::new(Profile {
                dialogs: compile(p.dialogs, &name)?,
                busy: compile(p.busy, &name)?,
                authenticating: compile(p.authenticating, &name)?,
                input_empty: compile(p.input_empty, &name)?,
                spinner: compile(p.spinner, &name)?,
                input,
                argv0: p.argv0,
                idle_ms: p.idle_ms,
                submit_delay_ms: p.submit_delay_ms,
                settle_ms: p.settle_ms,
                version: p.version,
                delivery: p.delivery,
                name,
            }));
        }
        Ok(ProfileSet { profiles })
    }

    pub fn all(&self) -> &[Arc<Profile>] {
        &self.profiles
    }

    pub fn get(&self, name: &str) -> Option<Arc<Profile>> {
        self.profiles.iter().find(|p| p.name == name).cloned()
    }

    pub fn select(&self, explicit: Option<&str>, argv0: &str) -> Result<Arc<Profile>, String> {
        if let Some(name) = explicit {
            return self
                .get(name)
                .ok_or_else(|| format!("unknown profile {name}"));
        }
        let base = std::path::Path::new(argv0)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or(argv0);
        if let Some(p) = self
            .profiles
            .iter()
            .find(|p| p.argv0.iter().any(|a| a == base))
        {
            return Ok(p.clone());
        }
        Ok(self
            .get("default")
            .unwrap_or_else(|| Arc::new(Profile::fallback())))
    }
}

#[path = "profile_input.rs"]
mod input;

#[cfg(test)]
#[path = "profile_tests.rs"]
mod tests;
