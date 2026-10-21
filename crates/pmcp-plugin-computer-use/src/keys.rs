// Key names as models write them ("ctrl+l", "Return", "shift+Tab") to X keysyms.

const NAMED: &[(&str, u32)] = &[
    ("return", 0xff0d),
    ("enter", 0xff0d),
    ("tab", 0xff09),
    ("escape", 0xff1b),
    ("esc", 0xff1b),
    ("backspace", 0xff08),
    ("delete", 0xffff),
    ("home", 0xff50),
    ("left", 0xff51),
    ("up", 0xff52),
    ("right", 0xff53),
    ("down", 0xff54),
    ("pageup", 0xff55),
    ("page_up", 0xff55),
    ("pagedown", 0xff56),
    ("page_down", 0xff56),
    ("end", 0xff57),
    ("insert", 0xff63),
    ("space", 0x20),
    ("shift", 0xffe1),
    ("ctrl", 0xffe3),
    ("control", 0xffe3),
    ("alt", 0xffe9),
    ("super", 0xffeb),
    ("meta", 0xffeb),
];

/// Latin-1 characters are their own keysym; everything else uses the Unicode keysym range.
pub fn char_keysym(c: char) -> u32 {
    let cp = c as u32;
    match cp {
        0x0a | 0x0d => 0xff0d,
        0x09 => 0xff09,
        0x20..=0x7e | 0xa0..=0xff => cp,
        _ => 0x0100_0000 | cp,
    }
}

fn keysym(name: &str) -> Result<u32, String> {
    let lower = name.to_ascii_lowercase();
    if let Some((_, sym)) = NAMED.iter().find(|(n, _)| *n == lower) {
        return Ok(*sym);
    }
    let function = lower.strip_prefix('f').and_then(|n| n.parse::<u32>().ok());
    if let Some(n) = function.filter(|n| (1..=24).contains(n)) {
        return Ok(0xffbe + n - 1);
    }
    let mut chars = name.chars();
    match (chars.next(), chars.next()) {
        (Some(c), None) => Ok(char_keysym(c)),
        _ => Err(format!("unknown key {name}")),
    }
}

/// "ctrl+shift+t" -> keysyms to hold, in order, the last one being the key itself.
pub fn chord(text: &str) -> Result<Vec<u32>, String> {
    let parts: Vec<&str> = text.split('+').map(str::trim).collect();
    if parts.iter().any(|p| p.is_empty()) {
        return Err(format!("bad key chord {text:?}"));
    }
    parts.into_iter().map(keysym).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chords_names_letters_and_unicode_map_to_keysyms() {
        assert_eq!(chord("ctrl+l").unwrap(), [0xffe3, 'l' as u32]);
        assert_eq!(chord("Shift+Tab").unwrap(), [0xffe1, 0xff09]);
        assert_eq!(chord("F5").unwrap(), [0xffc2]);
        assert_eq!(char_keysym('\u{D55C}'), 0x0100_0000 | '\u{D55C}' as u32);
        assert_eq!(char_keysym('é'), 0xe9);
        assert!(chord("ctrl+").is_err() && chord("hyper").is_err());
    }
}
