// Pure formatting for the multi-runtime HUD across narrow and wide terminal views,
// keeping status rendering free of terminal I/O for headless testing.

use std::fmt;

pub const WIDE_THRESHOLD: u16 = 80;
pub const MIN_COLS: u16 = 40;

/// Billing classification hint for runtime execution accounting.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum BillingHint {
    Subscription,
    Payg,
    Unspecified,
}

impl BillingHint {
    pub fn as_compact_str(&self) -> &'static str {
        match self {
            Self::Subscription => "sub",
            Self::Payg => "payg",
            Self::Unspecified => "-",
        }
    }

    pub fn as_wide_str(&self) -> &'static str {
        match self {
            Self::Subscription => "subscription",
            Self::Payg => "pay-as-you-go",
            Self::Unspecified => "unspecified",
        }
    }

    pub fn from_str_hint(s: &str) -> Self {
        let lower = s.trim().to_ascii_lowercase();
        match lower.as_str() {
            "sub" | "subscription" | "flat" => Self::Subscription,
            "payg" | "pay-as-you-go" | "pay_as_you_go" | "metered" | "usage" => Self::Payg,
            _ => Self::Unspecified,
        }
    }
}

impl fmt::Display for BillingHint {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_wide_str())
    }
}

/// Memory cap configured for a runtime session.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum MemoryCap {
    Uncapped,
    Megabytes(u32),
    Bytes(u64),
}

impl MemoryCap {
    pub fn from_mb(mb: u32) -> Self {
        Self::Megabytes(mb)
    }

    pub fn from_opt_mb(mb: Option<u32>) -> Self {
        match mb {
            Some(m) => Self::Megabytes(m),
            None => Self::Uncapped,
        }
    }

    pub fn to_megabytes(&self) -> Option<u32> {
        match self {
            Self::Uncapped => None,
            Self::Megabytes(mb) => Some(*mb),
            Self::Bytes(b) => Some((*b / (1024 * 1024)) as u32),
        }
    }

    pub fn format_compact(&self) -> String {
        match self {
            Self::Uncapped => "uncapped".to_string(),
            Self::Megabytes(mb) => {
                if *mb >= 1024 && *mb % 1024 == 0 {
                    format!("{}G", mb / 1024)
                } else {
                    format!("{mb}M")
                }
            }
            Self::Bytes(b) => {
                let mb = *b / (1024 * 1024);
                if mb >= 1024 && mb % 1024 == 0 {
                    format!("{}G", mb / 1024)
                } else if mb > 0 {
                    format!("{mb}M")
                } else {
                    format!("{}K", b / 1024)
                }
            }
        }
    }

    pub fn format_wide(&self) -> String {
        match self {
            Self::Uncapped => "uncapped".to_string(),
            Self::Megabytes(mb) => {
                if *mb >= 1024 && *mb % 1024 == 0 {
                    format!("{} MiB ({} GiB)", mb, mb / 1024)
                } else if *mb >= 1024 {
                    format!("{} MiB ({:.1} GiB)", mb, *mb as f64 / 1024.0)
                } else {
                    format!("{mb} MiB")
                }
            }
            Self::Bytes(b) => {
                let mb = *b as f64 / (1024.0 * 1024.0);
                if mb >= 1024.0 {
                    format!("{:.1} GiB", mb / 1024.0)
                } else if mb >= 1.0 {
                    format!("{:.0} MiB", mb)
                } else {
                    format!("{b} B")
                }
            }
        }
    }
}

impl fmt::Display for MemoryCap {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.format_wide())
    }
}

/// Lease synchronization state across concurrent sessions.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LeaseWaitState {
    Idle,
    Held {
        token: Option<String>,
    },
    Waiting {
        queue_position: u32,
        elapsed_ms: u64,
    },
    Contended,
}

impl LeaseWaitState {
    pub fn idle() -> Self {
        Self::Idle
    }

    pub fn held(token: Option<&str>) -> Self {
        Self::Held {
            token: token.map(|s| s.to_string()),
        }
    }

    pub fn waiting(queue_position: u32, elapsed_ms: u64) -> Self {
        Self::Waiting {
            queue_position,
            elapsed_ms,
        }
    }

    pub fn contended() -> Self {
        Self::Contended
    }

    pub fn format_compact(&self) -> String {
        match self {
            Self::Idle => "idle".to_string(),
            Self::Held { .. } => "held".to_string(),
            Self::Waiting {
                queue_position,
                elapsed_ms,
            } => {
                if *elapsed_ms < 1000 {
                    format!("wait#{queue_position}:{}ms", elapsed_ms)
                } else {
                    format!("wait#{queue_position}:{:.1}s", *elapsed_ms as f64 / 1000.0)
                }
            }
            Self::Contended => "contended".to_string(),
        }
    }

    pub fn format_wide(&self) -> String {
        match self {
            Self::Idle => "lease: idle".to_string(),
            Self::Held { token: Some(t) } => {
                let prefix = &t[..t.len().min(8)];
                format!("lease: held ({prefix})")
            }
            Self::Held { token: None } => "lease: held".to_string(),
            Self::Waiting {
                queue_position,
                elapsed_ms,
            } => {
                if *elapsed_ms < 1000 {
                    format!("lease: waiting (queue #{queue_position}, {elapsed_ms}ms)")
                } else {
                    format!(
                        "lease: waiting (queue #{queue_position}, {:.1}s)",
                        *elapsed_ms as f64 / 1000.0
                    )
                }
            }
            Self::Contended => "lease: contended".to_string(),
        }
    }
}

impl fmt::Display for LeaseWaitState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.format_wide())
    }
}

/// Observed runtime status for HUD presentation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RuntimeStatus {
    pub name: String,
    pub billing: BillingHint,
    pub memory: MemoryCap,
    pub lease: LeaseWaitState,
}

impl RuntimeStatus {
    pub fn new(
        name: impl Into<String>,
        billing: BillingHint,
        memory: MemoryCap,
        lease: LeaseWaitState,
    ) -> Self {
        Self {
            name: sanitize(&name.into()),
            billing,
            memory,
            lease,
        }
    }

    pub fn format_compact(&self) -> String {
        format!(
            "{} [{}/{}/{}]",
            self.name,
            self.billing.as_compact_str(),
            self.memory.format_compact(),
            self.lease.format_compact()
        )
    }

    pub fn format_wide(&self) -> String {
        format!(
            "{} | {} | mem: {} | {}",
            self.name,
            self.billing.as_wide_str(),
            self.memory.format_wide(),
            self.lease.format_wide()
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
        let minimal = format!(
            "{}:{}:{}:{}",
            self.name,
            self.billing.as_compact_str(),
            self.memory.format_compact(),
            self.lease.format_compact()
        );
        truncate_str(&minimal, max_w)
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

/// Formats a single status bar line from multiple runtime states, fitting within `width`.
pub fn format_hud_line(runtimes: &[RuntimeStatus], width: u16) -> String {
    let max_w = width as usize;
    if max_w == 0 {
        return String::new();
    }
    if runtimes.is_empty() {
        return truncate_str("[no runtimes]", max_w);
    }

    if width >= WIDE_THRESHOLD {
        let joined_wide = runtimes
            .iter()
            .map(|r| format!("[{}]", r.format_wide()))
            .collect::<Vec<_>>()
            .join("  ");
        if joined_wide.chars().count() <= max_w {
            return joined_wide;
        }
    }

    let joined_compact = runtimes
        .iter()
        .map(|r| r.format_compact())
        .collect::<Vec<_>>()
        .join(" | ");
    if joined_compact.chars().count() <= max_w {
        return joined_compact;
    }

    // Incremental packing with remaining counter when space is restricted.
    let mut parts: Vec<String> = Vec::new();
    for (i, r) in runtimes.iter().enumerate() {
        let remaining = runtimes.len() - (i + 1);
        let badge = r.format_compact();
        let candidate = if parts.is_empty() {
            if remaining > 0 {
                format!("{badge} (+{remaining} more)")
            } else {
                badge.clone()
            }
        } else {
            let mut test_parts = parts.clone();
            test_parts.push(badge.clone());
            if remaining > 0 {
                format!("{} (+{remaining} more)", test_parts.join(" | "))
            } else {
                test_parts.join(" | ")
            }
        };

        if candidate.chars().count() <= max_w {
            parts.push(badge);
        } else {
            break;
        }
    }

    if parts.is_empty() {
        let first = runtimes[0].format_compact();
        truncate_str(&first, max_w)
    } else {
        let shown = parts.len();
        let remaining = runtimes.len() - shown;
        if remaining > 0 {
            let res = format!("{} (+{remaining} more)", parts.join(" | "));
            truncate_str(&res, max_w)
        } else {
            let res = parts.join(" | ");
            truncate_str(&res, max_w)
        }
    }
}

/// Formats a multi-line HUD panel displaying all runtimes in columns or compact cards.
pub fn format_hud_panel(runtimes: &[RuntimeStatus], width: u16) -> Vec<String> {
    let max_w = width as usize;
    if max_w == 0 {
        return Vec::new();
    }
    if runtimes.is_empty() {
        return vec![truncate_str("No active runtimes registered.", max_w)];
    }

    let mut lines = Vec::new();
    if width >= WIDE_THRESHOLD {
        let name_col = 22;
        let bill_col = 16;
        let mem_col = 20;
        let header = format!(
            "{} {} {} {}",
            pad_right("RUNTIME", name_col),
            pad_right("BILLING", bill_col),
            pad_right("MEMORY CAP", mem_col),
            "LEASE STATE"
        );
        lines.push(truncate_str(&header, max_w));
        let sep = "-".repeat(max_w.min(header.chars().count()));
        lines.push(sep);

        for r in runtimes {
            let row = format!(
                "{} {} {} {}",
                pad_right(&truncate_str(&r.name, name_col), name_col),
                pad_right(r.billing.as_wide_str(), bill_col),
                pad_right(&r.memory.format_wide(), mem_col),
                r.lease.format_wide()
            );
            lines.push(truncate_str(&row, max_w));
        }
    } else {
        let name_col = 14;
        let bill_col = 6;
        let mem_col = 10;
        let header = format!(
            "{} {} {} {}",
            pad_right("RUNTIME", name_col),
            pad_right("BILL", bill_col),
            pad_right("MEM", mem_col),
            "LEASE"
        );
        lines.push(truncate_str(&header, max_w));
        let sep = "-".repeat(max_w.min(header.chars().count()));
        lines.push(sep);

        for r in runtimes {
            let row = format!(
                "{} {} {} {}",
                pad_right(&truncate_str(&r.name, name_col), name_col),
                pad_right(r.billing.as_compact_str(), bill_col),
                pad_right(&r.memory.format_compact(), mem_col),
                r.lease.format_compact()
            );
            lines.push(truncate_str(&row, max_w));
        }
    }
    lines
}

/// Formats runtimes for narrow dock display (typically 28 to 40 columns).
pub fn format_hud_dock(runtimes: &[RuntimeStatus], width: u16) -> Vec<String> {
    let max_w = width as usize;
    if max_w == 0 {
        return Vec::new();
    }
    if runtimes.is_empty() {
        return vec![truncate_str("NO RUNTIMES", max_w)];
    }

    let mut lines = Vec::new();
    lines.push(truncate_str("RUNTIMES / status", max_w));
    for (i, r) in runtimes.iter().enumerate() {
        let num = i + 1;
        let title = format!("{num}. {} ({})", r.name, r.billing.as_compact_str());
        lines.push(truncate_str(&title, max_w));
        let sub = format!(
            "   mem: {} | {}",
            r.memory.format_compact(),
            r.lease.format_compact()
        );
        lines.push(truncate_str(&sub, max_w));
    }
    lines
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn billing_hint_formatting_and_parsing() {
        assert_eq!(BillingHint::Subscription.as_compact_str(), "sub");
        assert_eq!(BillingHint::Subscription.as_wide_str(), "subscription");
        assert_eq!(BillingHint::Payg.as_compact_str(), "payg");
        assert_eq!(BillingHint::Payg.as_wide_str(), "pay-as-you-go");
        assert_eq!(BillingHint::Unspecified.as_compact_str(), "-");
        assert_eq!(BillingHint::Unspecified.as_wide_str(), "unspecified");

        assert_eq!(BillingHint::from_str_hint("sub"), BillingHint::Subscription);
        assert_eq!(
            BillingHint::from_str_hint("SUBSCRIPTION"),
            BillingHint::Subscription
        );
        assert_eq!(BillingHint::from_str_hint("payg"), BillingHint::Payg);
        assert_eq!(
            BillingHint::from_str_hint("pay-as-you-go"),
            BillingHint::Payg
        );
        assert_eq!(
            BillingHint::from_str_hint("other"),
            BillingHint::Unspecified
        );
    }

    #[test]
    fn memory_cap_formatting() {
        assert_eq!(MemoryCap::Uncapped.format_compact(), "uncapped");
        assert_eq!(MemoryCap::Uncapped.format_wide(), "uncapped");
        assert_eq!(MemoryCap::Uncapped.to_megabytes(), None);

        let m768 = MemoryCap::from_mb(768);
        assert_eq!(m768.format_compact(), "768M");
        assert_eq!(m768.format_wide(), "768 MiB");
        assert_eq!(m768.to_megabytes(), Some(768));

        let m2048 = MemoryCap::from_mb(2048);
        assert_eq!(m2048.format_compact(), "2G");
        assert_eq!(m2048.format_wide(), "2048 MiB (2 GiB)");

        let b1g = MemoryCap::Bytes(1024 * 1024 * 1024);
        assert_eq!(b1g.format_compact(), "1G");
        assert_eq!(b1g.to_megabytes(), Some(1024));
    }

    #[test]
    fn lease_wait_state_formatting() {
        let idle = LeaseWaitState::idle();
        assert_eq!(idle.format_compact(), "idle");
        assert_eq!(idle.format_wide(), "lease: idle");

        let held = LeaseWaitState::held(Some("tok123456789"));
        assert_eq!(held.format_compact(), "held");
        assert_eq!(held.format_wide(), "lease: held (tok12345)");

        let held_no_token = LeaseWaitState::held(None);
        assert_eq!(held_no_token.format_wide(), "lease: held");

        let waiting_ms = LeaseWaitState::waiting(1, 450);
        assert_eq!(waiting_ms.format_compact(), "wait#1:450ms");
        assert_eq!(waiting_ms.format_wide(), "lease: waiting (queue #1, 450ms)");

        let waiting_sec = LeaseWaitState::waiting(2, 2500);
        assert_eq!(waiting_sec.format_compact(), "wait#2:2.5s");
        assert_eq!(waiting_sec.format_wide(), "lease: waiting (queue #2, 2.5s)");

        let cont = LeaseWaitState::contended();
        assert_eq!(cont.format_compact(), "contended");
        assert_eq!(cont.format_wide(), "lease: contended");
    }

    #[test]
    fn single_runtime_formatting_wide_and_narrow() {
        let r = RuntimeStatus::new(
            "worker-claude",
            BillingHint::Subscription,
            MemoryCap::from_mb(768),
            LeaseWaitState::idle(),
        );

        let wide = r.format_for_width(120);
        assert!(wide.contains("worker-claude"));
        assert!(wide.contains("subscription"));
        assert!(wide.contains("768 MiB"));
        assert!(wide.contains("lease: idle"));

        let narrow = r.format_for_width(40);
        assert!(narrow.chars().count() <= 40);
        assert!(narrow.contains("sub"));
        assert!(narrow.contains("768M"));
    }

    #[test]
    fn multi_runtime_line_never_overflows_width() {
        let r1 = RuntimeStatus::new(
            "agent-1",
            BillingHint::Subscription,
            MemoryCap::from_mb(768),
            LeaseWaitState::idle(),
        );
        let r2 = RuntimeStatus::new(
            "agent-2",
            BillingHint::Payg,
            MemoryCap::Uncapped,
            LeaseWaitState::waiting(1, 1500),
        );
        let r3 = RuntimeStatus::new(
            "agent-3",
            BillingHint::Payg,
            MemoryCap::from_mb(2048),
            LeaseWaitState::contended(),
        );
        let list = vec![r1, r2, r3];

        for width in [10, 20, 30, 40, 60, 80, 120, 160] {
            let line = format_hud_line(&list, width);
            assert!(
                line.chars().count() <= width as usize,
                "overflow at width {width}: len {} vs line '{line}'",
                line.chars().count()
            );
        }
    }

    #[test]
    fn multi_runtime_panel_formatting() {
        let r1 = RuntimeStatus::new(
            "agent-alpha",
            BillingHint::Subscription,
            MemoryCap::from_mb(512),
            LeaseWaitState::idle(),
        );
        let r2 = RuntimeStatus::new(
            "agent-beta",
            BillingHint::Payg,
            MemoryCap::Uncapped,
            LeaseWaitState::held(Some("abc")),
        );
        let list = vec![r1, r2];

        let wide_panel = format_hud_panel(&list, 100);
        assert!(!wide_panel.is_empty());
        for line in &wide_panel {
            assert!(line.chars().count() <= 100);
        }

        let narrow_panel = format_hud_panel(&list, 45);
        assert!(!narrow_panel.is_empty());
        for line in &narrow_panel {
            assert!(line.chars().count() <= 45);
        }
    }

    #[test]
    fn dock_formatting_fits_dock_columns() {
        let r1 = RuntimeStatus::new(
            "main-session",
            BillingHint::Subscription,
            MemoryCap::from_mb(1024),
            LeaseWaitState::idle(),
        );
        let list = vec![r1];

        for w in [28, 30, 35, 40] {
            let dock = format_hud_dock(&list, w);
            for line in dock {
                assert!(line.chars().count() <= w as usize);
            }
        }
    }

    #[test]
    fn sanitize_removes_control_characters() {
        let dirty = "runtime\u{001b}[31m\t\nname";
        let clean = sanitize(dirty);
        assert!(!clean.contains('\u{001b}'));
        assert!(!clean.contains('\n'));
    }
}
