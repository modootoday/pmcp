use crate::keys::HELP;
use crate::state::{App, Panel, Phase};

// Text for the dock, coordination and status rows, worded like the tmux workspace's panels.
pub fn safe(value: &str) -> String {
    value
        .chars()
        .map(|c| match c {
            '\u{0}'..='\u{1f}' | '\u{7f}'..='\u{9f}' => '?',
            c => c,
        })
        .collect()
}

fn short(id: &str) -> &str {
    &id[..id.len().min(8)]
}

pub fn dock_lines(app: &App) -> Vec<String> {
    let mut lines = vec!["WORKERS / observe only".to_string()];
    for (i, w) in app.workers().iter().enumerate() {
        let shown = if app.target.as_ref() == Some(&w.id) {
            ">"
        } else {
            " "
        };
        let state = if w.alive {
            w.status.as_str()
        } else {
            "unavailable"
        };
        lines.push(format!(
            "{shown}{}. {} {} {}",
            i + 1,
            safe(&w.runtime),
            safe(short(&w.name)),
            safe(state)
        ));
    }
    lines.extend(
        [
            "",
            "Ctrl-g w: observe worker",
            "Ctrl-g m: return to main",
            "Ctrl-g g: management",
            "Ctrl-g d: detach view",
            "Ctrl-g !: dismiss error",
            "Ctrl-g ?: keys",
        ]
        .map(String::from),
    );
    lines
}

pub fn target_status(app: &App) -> String {
    let role = match app.target_info() {
        Some(s) if s.main => "MAIN",
        Some(_) => "WORKER",
        None => "NO TARGET",
    };
    let name = app.target_info().map(|s| safe(&s.name)).unwrap_or_default();
    let phase = match app.phase {
        Phase::ReadOnly => "OBSERVE / INPUT OFF",
        Phase::Acquiring => "REQUESTING CONTROL / INPUT OFF",
        Phase::Connecting => "CONNECTING WRITER / INPUT OFF",
        Phase::Controlled => "CONTROL READY / INPUT ON",
        Phase::Releasing => "RELEASING CONTROL / INPUT OFF",
        Phase::Uncertain => "CONTROL UNKNOWN / INPUT OFF",
    };
    format!("{role} {name} | {phase}")
}

pub fn coordination_lines(app: &App) -> Vec<String> {
    let target = format!("TARGET {}", target_status(app));
    if let Some(f) = &app.failure {
        return vec![
            target,
            format!("ERROR {} ({})", safe(&f.code), safe(&f.action)),
            safe(&f.hint),
            "No input replay. Ctrl-g ! dismisses this error; Ctrl-g ? shows keys.".into(),
        ];
    }
    let alive = app.sessions.iter().filter(|s| s.alive).count();
    vec![
        target,
        format!(
            "{} sessions / {alive} alive, hosted by pmcp-pty",
            app.sessions.len()
        ),
        "No automatic wake or input replay from this view.".into(),
        "Native OAuth, trust and permissions remain in their native screens.".into(),
    ]
}

pub fn status_line(app: &App) -> String {
    if app.panel == Panel::Help {
        return HELP.to_string();
    }
    match &app.failure {
        Some(f) => format!("{} | ERROR {}", target_status(app), safe(&f.code)),
        None => format!("{} | Ctrl-g ? keys", target_status(app)),
    }
}
