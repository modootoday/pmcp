// Pure formatting for mailbox handoff and status panels across terminal widths,
// keeping rendering decoupled from terminal I/O for headless verification.

use std::fmt;

pub const WIDE_THRESHOLD: u16 = 80;
pub const MIN_COLS: u16 = 40;

/// Urgency level for mailbox handoff items.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum HandoffPriority {
    Low,
    Normal,
    High,
    Urgent,
}

impl HandoffPriority {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::Normal => "normal",
            Self::High => "high",
            Self::Urgent => "urgent",
        }
    }

    pub fn as_compact_str(&self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::Normal => "norm",
            Self::High => "high",
            Self::Urgent => "urg",
        }
    }

    pub fn as_badge(&self, wide: bool) -> &'static str {
        if wide {
            match self {
                Self::Low => "[LOW]",
                Self::Normal => "[NORMAL]",
                Self::High => "[HIGH]",
                Self::Urgent => "[URGENT]",
            }
        } else {
            match self {
                Self::Low => "[L]",
                Self::Normal => "[N]",
                Self::High => "[H]",
                Self::Urgent => "[!]",
            }
        }
    }

    pub fn from_str_hint(s: &str) -> Self {
        let lower = s.trim().to_ascii_lowercase();
        match lower.as_str() {
            "u" | "urg" | "urgent" | "p0" | "critical" => Self::Urgent,
            "h" | "high" | "p1" => Self::High,
            "l" | "low" | "p3" => Self::Low,
            _ => Self::Normal,
        }
    }
}

impl fmt::Display for HandoffPriority {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Lifecycle status for mailbox tasks and handoffs.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum HandoffStatus {
    Unread,
    Read,
    Accepted,
    Completed,
}

impl HandoffStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Unread => "unread",
            Self::Read => "read",
            Self::Accepted => "accepted",
            Self::Completed => "completed",
        }
    }

    pub fn as_compact_str(&self) -> &'static str {
        match self {
            Self::Unread => "new",
            Self::Read => "seen",
            Self::Accepted => "ack",
            Self::Completed => "done",
        }
    }

    pub fn is_unread(&self) -> bool {
        matches!(self, Self::Unread)
    }
}

impl fmt::Display for HandoffStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// A single mailbox task or handoff message item.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HandoffItem {
    pub id: String,
    pub sender: String,
    pub recipient: String,
    pub subject: String,
    pub priority: HandoffPriority,
    pub status: HandoffStatus,
}

impl HandoffItem {
    pub fn new(
        id: impl Into<String>,
        sender: impl Into<String>,
        recipient: impl Into<String>,
        subject: impl Into<String>,
        priority: HandoffPriority,
        status: HandoffStatus,
    ) -> Self {
        Self {
            id: sanitize(&id.into()),
            sender: sanitize(&sender.into()),
            recipient: sanitize(&recipient.into()),
            subject: sanitize(&subject.into()),
            priority,
            status,
        }
    }

    pub fn alias_pair(&self) -> String {
        format!("{} -> {}", self.sender, self.recipient)
    }

    pub fn format_wide(&self) -> String {
        format!(
            "{} {} | {} -> {} | {}",
            self.priority.as_badge(true),
            self.status.as_str(),
            self.sender,
            self.recipient,
            self.subject
        )
    }

    pub fn format_compact(&self) -> String {
        format!(
            "{} {} {} -> {}: {}",
            self.priority.as_badge(false),
            self.status.as_compact_str(),
            self.sender,
            self.recipient,
            self.subject
        )
    }

    pub fn format_for_width(&self, width: u16) -> String {
        let max_w = width as usize;
        if max_w == 0 {
            return String::new();
        }
        if width >= WIDE_THRESHOLD {
            let wide = self.format_wide();
            if wide.chars().count() <= max_w {
                return wide;
            }
        }
        let compact = self.format_compact();
        if compact.chars().count() <= max_w {
            return compact;
        }
        truncate_str(&compact, max_w)
    }
}

/// Aggregate mailbox counter and identity summary.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MailboxSummary {
    pub inbox_alias: String,
    pub unread_count: u32,
    pub total_count: u32,
    pub urgent_count: u32,
}

impl MailboxSummary {
    pub fn new(
        inbox_alias: impl Into<String>,
        unread_count: u32,
        total_count: u32,
        urgent_count: u32,
    ) -> Self {
        Self {
            inbox_alias: sanitize(&inbox_alias.into()),
            unread_count,
            total_count,
            urgent_count,
        }
    }

    pub fn from_items(inbox_alias: impl Into<String>, items: &[HandoffItem]) -> Self {
        let mut unread = 0;
        let mut urgent = 0;
        for item in items {
            if item.status.is_unread() {
                unread += 1;
            }
            if item.priority == HandoffPriority::Urgent {
                urgent += 1;
            }
        }
        Self::new(inbox_alias, unread, items.len() as u32, urgent)
    }

    pub fn format_compact(&self) -> String {
        if self.urgent_count > 0 {
            format!(
                "{}: {}/{} unread (!{})",
                self.inbox_alias, self.unread_count, self.total_count, self.urgent_count
            )
        } else {
            format!(
                "{}: {}/{} unread",
                self.inbox_alias, self.unread_count, self.total_count
            )
        }
    }

    pub fn format_wide(&self) -> String {
        if self.urgent_count > 0 {
            format!(
                "Mailbox <{}> | {} unread / {} total | {} urgent",
                self.inbox_alias, self.unread_count, self.total_count, self.urgent_count
            )
        } else {
            format!(
                "Mailbox <{}> | {} unread / {} total",
                self.inbox_alias, self.unread_count, self.total_count
            )
        }
    }

    pub fn format_status_line(&self, width: u16) -> String {
        let max_w = width as usize;
        if max_w == 0 {
            return String::new();
        }
        if width >= WIDE_THRESHOLD {
            let wide = self.format_wide();
            if wide.chars().count() <= max_w {
                return wide;
            }
        }
        let compact = self.format_compact();
        truncate_str(&compact, max_w)
    }
}

pub fn sanitize(value: &str) -> String {
    value
        .chars()
        .map(|c| match c {
            '\u{0}'..='\u{1f}' | '\u{7f}'..='\u{9f}' => '?',
            c => c,
        })
        .collect()
}

pub fn truncate_str(s: &str, max_width: usize) -> String {
    let char_count = s.chars().count();
    if char_count <= max_width {
        return s.to_string();
    }
    if max_width == 0 {
        return String::new();
    }
    if max_width <= 2 {
        return s.chars().take(max_width).collect();
    }
    let mut res: String = s.chars().take(max_width - 1).collect();
    res.push('…');
    res
}

fn pad_right(s: &str, width: usize) -> String {
    let count = s.chars().count();
    if count >= width {
        s.to_string()
    } else {
        let mut padded = s.to_string();
        padded.push_str(&" ".repeat(width - count));
        padded
    }
}

pub fn format_alias_pair(sender: &str, recipient: &str, max_width: usize) -> String {
    let combined = format!("{sender} -> {recipient}");
    truncate_str(&combined, max_width)
}

/// Formats a single status bar line for mailbox state fitting within `width`.
pub fn format_mailbox_status_line(summary: &MailboxSummary, width: u16) -> String {
    summary.format_status_line(width)
}

/// Formats a multi-line mailbox panel displaying handoff tasks in columns or cards.
pub fn format_mailbox_panel(
    summary: &MailboxSummary,
    items: &[HandoffItem],
    width: u16,
) -> Vec<String> {
    let max_w = width as usize;
    if max_w == 0 {
        return Vec::new();
    }

    let mut lines = Vec::new();
    lines.push(summary.format_status_line(width));

    if items.is_empty() {
        let sep = "-".repeat(max_w.min(40));
        lines.push(sep);
        lines.push(truncate_str("No handoff tasks in mailbox.", max_w));
        return lines;
    }

    if width >= WIDE_THRESHOLD {
        let id_col = 10;
        let prio_col = 10;
        let stat_col = 11;
        let alias_col = 24;

        let sep = "-".repeat(max_w);
        lines.push(sep);

        let header = format!(
            "{} {} {} {} {}",
            pad_right("ID", id_col),
            pad_right("PRIORITY", prio_col),
            pad_right("STATUS", stat_col),
            pad_right("FROM -> TO", alias_col),
            "SUBJECT"
        );
        lines.push(truncate_str(&header, max_w));
        let header_sep = "-".repeat(max_w.min(header.chars().count()));
        lines.push(header_sep);

        for item in items {
            let fixed_prefix = format!(
                "{} {} {} {} ",
                pad_right(&truncate_str(&item.id, id_col), id_col),
                pad_right(item.priority.as_badge(true), prio_col),
                pad_right(item.status.as_str(), stat_col),
                pad_right(&truncate_str(&item.alias_pair(), alias_col), alias_col),
            );
            let prefix_len = fixed_prefix.chars().count();
            let subject_len = if max_w > prefix_len {
                max_w - prefix_len
            } else {
                0
            };
            let row = format!("{}{}", fixed_prefix, truncate_str(&item.subject, subject_len));
            lines.push(truncate_str(&row, max_w));
        }
    } else {
        let sep = "-".repeat(max_w);
        lines.push(sep);

        for item in items {
            let line1 = format!(
                "{} {} {}",
                item.priority.as_badge(false),
                item.status.as_compact_str(),
                item.subject
            );
            lines.push(truncate_str(&line1, max_w));

            let aliases = format_alias_pair(&item.sender, &item.recipient, max_w.saturating_sub(4));
            let line2 = format!("  {aliases}");
            lines.push(truncate_str(&line2, max_w));
        }
    }

    lines
}

/// Formats mailbox handoff items for narrow dock display (typically 28 to 40 columns).
pub fn format_mailbox_dock(
    summary: &MailboxSummary,
    items: &[HandoffItem],
    width: u16,
) -> Vec<String> {
    let max_w = width as usize;
    if max_w == 0 {
        return Vec::new();
    }

    let mut lines = Vec::new();
    let header = if summary.unread_count > 0 {
        format!("MAILBOX / {} unread", summary.unread_count)
    } else {
        "MAILBOX / idle".to_string()
    };
    lines.push(truncate_str(&header, max_w));

    if items.is_empty() {
        lines.push(truncate_str("  (no tasks)", max_w));
        return lines;
    }

    for (i, item) in items.iter().enumerate() {
        let num = i + 1;
        let title = format!("{num}. {} {}", item.priority.as_badge(false), item.subject);
        lines.push(truncate_str(&title, max_w));

        let sub = format!("   {} -> {}", item.sender, item.recipient);
        lines.push(truncate_str(&sub, max_w));
    }

    lines
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn priority_badge_and_parsing() {
        assert_eq!(HandoffPriority::Urgent.as_badge(true), "[URGENT]");
        assert_eq!(HandoffPriority::Urgent.as_badge(false), "[!]");
        assert_eq!(HandoffPriority::High.as_badge(true), "[HIGH]");
        assert_eq!(HandoffPriority::High.as_badge(false), "[H]");
        assert_eq!(HandoffPriority::Normal.as_badge(true), "[NORMAL]");
        assert_eq!(HandoffPriority::Normal.as_badge(false), "[N]");
        assert_eq!(HandoffPriority::Low.as_badge(true), "[LOW]");
        assert_eq!(HandoffPriority::Low.as_badge(false), "[L]");

        assert_eq!(HandoffPriority::from_str_hint("urgent"), HandoffPriority::Urgent);
        assert_eq!(HandoffPriority::from_str_hint("P0"), HandoffPriority::Urgent);
        assert_eq!(HandoffPriority::from_str_hint("high"), HandoffPriority::High);
        assert_eq!(HandoffPriority::from_str_hint("p1"), HandoffPriority::High);
        assert_eq!(HandoffPriority::from_str_hint("low"), HandoffPriority::Low);
        assert_eq!(HandoffPriority::from_str_hint("anything"), HandoffPriority::Normal);
    }

    #[test]
    fn status_formatting_and_predicates() {
        assert_eq!(HandoffStatus::Unread.as_str(), "unread");
        assert_eq!(HandoffStatus::Unread.as_compact_str(), "new");
        assert!(HandoffStatus::Unread.is_unread());

        assert_eq!(HandoffStatus::Read.as_str(), "read");
        assert_eq!(HandoffStatus::Read.as_compact_str(), "seen");
        assert!(!HandoffStatus::Read.is_unread());

        assert_eq!(HandoffStatus::Accepted.as_compact_str(), "ack");
        assert_eq!(HandoffStatus::Completed.as_compact_str(), "done");
    }

    #[test]
    fn alias_pair_formatting() {
        let pair = format_alias_pair("coordinator", "worker-1", 30);
        assert_eq!(pair, "coordinator -> worker-1");

        let truncated = format_alias_pair("coordinator-main", "worker-secondary", 12);
        assert!(truncated.chars().count() <= 12);
        assert!(truncated.ends_with('…'));
    }

    #[test]
    fn summary_formatting_wide_and_narrow() {
        let s = MailboxSummary::new("agent-1", 3, 10, 1);
        assert_eq!(s.format_compact(), "agent-1: 3/10 unread (!1)");
        assert_eq!(s.format_wide(), "Mailbox <agent-1> | 3 unread / 10 total | 1 urgent");

        let s_no_urgent = MailboxSummary::new("agent-2", 0, 5, 0);
        assert_eq!(s_no_urgent.format_compact(), "agent-2: 0/5 unread");
        assert_eq!(s_no_urgent.format_wide(), "Mailbox <agent-2> | 0 unread / 5 total");

        let narrow = s.format_status_line(25);
        assert!(narrow.chars().count() <= 25);
    }

    #[test]
    fn summary_from_items_calculation() {
        let items = vec![
            HandoffItem::new("1", "a", "b", "task 1", HandoffPriority::Urgent, HandoffStatus::Unread),
            HandoffItem::new("2", "a", "b", "task 2", HandoffPriority::High, HandoffStatus::Read),
            HandoffItem::new("3", "b", "a", "task 3", HandoffPriority::Normal, HandoffStatus::Unread),
        ];
        let summary = MailboxSummary::from_items("agent-test", &items);
        assert_eq!(summary.total_count, 3);
        assert_eq!(summary.unread_count, 2);
        assert_eq!(summary.urgent_count, 1);
    }

    #[test]
    fn single_handoff_item_formatting() {
        let item = HandoffItem::new(
            "msg-101",
            "coordinator",
            "worker-alpha",
            "Deploy verification runner",
            HandoffPriority::Urgent,
            HandoffStatus::Unread,
        );

        let wide = item.format_for_width(120);
        assert!(wide.contains("[URGENT]"));
        assert!(wide.contains("coordinator -> worker-alpha"));
        assert!(wide.contains("Deploy verification runner"));

        let narrow = item.format_for_width(40);
        assert!(narrow.chars().count() <= 40);
        assert!(narrow.contains("[!]"));
    }

    #[test]
    fn multi_item_panel_fits_width() {
        let items = vec![
            HandoffItem::new(
                "h-01",
                "coord",
                "worker-1",
                "Implement database schema migration",
                HandoffPriority::Urgent,
                HandoffStatus::Unread,
            ),
            HandoffItem::new(
                "h-02",
                "worker-2",
                "coord",
                "Test run completed with zero failures",
                HandoffPriority::Normal,
                HandoffStatus::Read,
            ),
            HandoffItem::new(
                "h-03",
                "reviewer",
                "worker-1",
                "Security review feedback for authentication handler",
                HandoffPriority::High,
                HandoffStatus::Accepted,
            ),
        ];
        let summary = MailboxSummary::from_items("coord", &items);

        for width in [10, 20, 30, 40, 60, 80, 100, 120, 160] {
            let panel = format_mailbox_panel(&summary, &items, width);
            assert!(!panel.is_empty());
            for line in &panel {
                assert!(
                    line.chars().count() <= width as usize,
                    "overflow at width {width}: len {} vs line '{line}'",
                    line.chars().count()
                );
            }
        }
    }

    #[test]
    fn dock_formatting_fits_columns() {
        let items = vec![
            HandoffItem::new("t-1", "src", "dst", "Task one", HandoffPriority::Urgent, HandoffStatus::Unread),
            HandoffItem::new("t-2", "src", "dst", "Task two", HandoffPriority::Low, HandoffStatus::Read),
        ];
        let summary = MailboxSummary::from_items("dst", &items);

        for w in [28, 30, 35, 40] {
            let dock = format_mailbox_dock(&summary, &items, w);
            for line in dock {
                assert!(line.chars().count() <= w as usize);
            }
        }
    }

    #[test]
    fn empty_mailbox_panel_and_dock() {
        let empty: Vec<HandoffItem> = Vec::new();
        let summary = MailboxSummary::from_items("idle-agent", &empty);

        let panel_wide = format_mailbox_panel(&summary, &empty, 100);
        assert!(!panel_wide.is_empty());
        assert!(panel_wide.iter().any(|l| l.contains("No handoff tasks")));

        let dock = format_mailbox_dock(&summary, &empty, 30);
        assert!(!dock.is_empty());
        assert!(dock.iter().any(|l| l.contains("idle")));
    }

    #[test]
    fn sanitize_removes_control_characters() {
        let dirty = "sender\u{001b}[31m\t\nname";
        let clean = sanitize(dirty);
        assert!(!clean.contains('\u{001b}'));
        assert!(!clean.contains('\n'));
    }
}
