use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

// A key as the bytes a terminal sends for it, so the session sees what it would see in a real
// terminal; arrows follow the session's application cursor mode.
pub fn encode(k: &KeyEvent, app_cursor: bool) -> Option<Vec<u8>> {
    let ctrl = k.modifiers.contains(KeyModifiers::CONTROL);
    let alt = k.modifiers.contains(KeyModifiers::ALT);
    let arrow = |c: u8| match app_cursor {
        true => vec![0x1b, b'O', c],
        false => vec![0x1b, b'[', c],
    };
    let mut out = match k.code {
        KeyCode::Char(c) if ctrl => match c.to_ascii_lowercase() {
            c @ 'a'..='z' => vec![c as u8 - b'a' + 1],
            ' ' | '@' => vec![0],
            '[' => vec![0x1b],
            '\\' => vec![0x1c],
            ']' => vec![0x1d],
            _ => return None,
        },
        KeyCode::Char(c) => c.to_string().into_bytes(),
        KeyCode::Enter => vec![b'\r'],
        KeyCode::Tab => vec![b'\t'],
        KeyCode::BackTab => b"\x1b[Z".to_vec(),
        KeyCode::Backspace => vec![0x7f],
        KeyCode::Esc => vec![0x1b],
        KeyCode::Up => arrow(b'A'),
        KeyCode::Down => arrow(b'B'),
        KeyCode::Right => arrow(b'C'),
        KeyCode::Left => arrow(b'D'),
        KeyCode::Home => b"\x1b[H".to_vec(),
        KeyCode::End => b"\x1b[F".to_vec(),
        KeyCode::PageUp => b"\x1b[5~".to_vec(),
        KeyCode::PageDown => b"\x1b[6~".to_vec(),
        KeyCode::Insert => b"\x1b[2~".to_vec(),
        KeyCode::Delete => b"\x1b[3~".to_vec(),
        KeyCode::F(n @ 1..=4) => vec![0x1b, b'O', b'P' + n - 1],
        _ => return None,
    };
    if alt {
        out.insert(0, 0x1b);
    }
    Some(out)
}

/// Pasted text, wrapped in bracketed-paste markers when the session asked for them; markers
/// inside the text are dropped so a paste can never end itself early.
pub fn paste(text: &str, bracketed: bool) -> Vec<u8> {
    let clean = text.replace("\x1b[201~", "").replace("\x1b[200~", "");
    match bracketed {
        true => format!("\x1b[200~{clean}\x1b[201~").into_bytes(),
        false => clean.replace("\r\n", "\r").replace('\n', "\r").into_bytes(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(code: KeyCode, m: KeyModifiers) -> KeyEvent {
        KeyEvent::new(code, m)
    }

    #[test]
    fn keys_become_terminal_bytes() {
        let none = KeyModifiers::NONE;
        assert_eq!(
            encode(&key(KeyCode::Char('\u{D55C}'), none), false),
            Some("\u{D55C}".as_bytes().to_vec())
        );
        assert_eq!(
            encode(&key(KeyCode::Char('c'), KeyModifiers::CONTROL), false),
            Some(vec![3])
        );
        assert_eq!(
            encode(&key(KeyCode::Up, none), false),
            Some(b"\x1b[A".to_vec())
        );
        assert_eq!(
            encode(&key(KeyCode::Up, none), true),
            Some(b"\x1bOA".to_vec())
        );
        assert_eq!(
            encode(&key(KeyCode::Char('b'), KeyModifiers::ALT), false),
            Some(b"\x1bb".to_vec())
        );
        assert_eq!(
            encode(&key(KeyCode::Enter, none), false),
            Some(b"\r".to_vec())
        );
        assert_eq!(encode(&key(KeyCode::F(9), none), false), None);
    }

    #[test]
    fn a_paste_cannot_close_its_own_brackets() {
        assert_eq!(paste("a\x1b[201~b", true), b"\x1b[200~ab\x1b[201~".to_vec());
        assert_eq!(paste("one\ntwo", false), b"one\rtwo".to_vec());
    }
}
