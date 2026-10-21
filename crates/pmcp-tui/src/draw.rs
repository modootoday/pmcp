use crate::layout::{Mode, plan};
use crate::screen::ScreenView;
use crate::state::{App, Panel};
use crate::summary::{coordination_lines, dock_lines, status_line};
use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::Line;
use ratatui::widgets::{Paragraph, Wrap};

fn lines(text: Vec<String>, area: Rect) -> Paragraph<'static> {
    let rows: Vec<Line> = text
        .into_iter()
        .take(area.height as usize)
        .map(Line::from)
        .collect();
    Paragraph::new(rows)
}

pub fn draw(frame: &mut Frame, app: &App) {
    let area = frame.area();
    let p = match plan(area.width, area.height) {
        Ok(p) => p,
        Err(why) => {
            frame.render_widget(Paragraph::new(why).wrap(Wrap { trim: true }), area);
            return;
        }
    };
    let management = app.panel == Panel::Management && p.mode == Mode::Compact;
    if management {
        // The compact management screen: dock and coordination stacked, as in the tmux window.
        let mut text = dock_lines(app);
        text.push(String::new());
        text.extend(coordination_lines(app));
        frame.render_widget(lines(text, p.main), p.main);
    } else if app.panel == Panel::History {
        let page = app.history.iter().skip(app.history_top).cloned().collect();
        frame.render_widget(lines(page, p.main), p.main);
    } else if app.panel == Panel::Mailbox {
        frame.render_widget(lines(app.mailbox.clone(), p.main), p.main);
    } else {
        match &app.parser {
            Some(parser) => frame.render_widget(
                ScreenView {
                    screen: parser.screen(),
                },
                p.main,
            ),
            None => frame.render_widget(lines(vec![no_target(app)], p.main), p.main),
        }
    }
    if let Some(dock) = p.dock {
        let rule = Rect::new(dock.x - 1, dock.y, 1, dock.height);
        frame.render_widget(lines(vec!["│".into(); rule.height as usize], rule), rule);
        frame.render_widget(lines(dock_lines(app), dock), dock);
    }
    if let Some(c) = p.coordination {
        let rule = Rect::new(c.x, c.y - 1, c.width, 1);
        frame.render_widget(Paragraph::new("─".repeat(rule.width as usize)), rule);
        frame.render_widget(lines(coordination_lines(app), c), c);
    }
    let status =
        Paragraph::new(status_line(app)).style(Style::default().add_modifier(Modifier::REVERSED));
    frame.render_widget(status, p.status);
}

fn no_target(app: &App) -> String {
    match app.target_info() {
        Some(s) if !s.alive => format!("{} has exited. Ctrl-g m returns to main.", s.name),
        _ if app.sessions.is_empty() => "No sessions on this pmcp-pty host yet.".into(),
        _ => "Connecting to the session...".into(),
    }
}
