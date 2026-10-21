const PASTE_START: &str = "\x1b[200~";
const PASTE_END: &str = "\x1b[201~";

fn sanitize(text: &str) -> String {
    let unified = text.replace("\r\n", "\n");
    unified
        .chars()
        .filter(|c| *c == '\n' || *c == '\t' || !c.is_control())
        .map(|c| match c {
            '\n' => '\r',
            other => other,
        })
        .collect()
}

/// Text never carries escape or control bytes, so it cannot close the paste or act as a key.
pub fn encode_text(text: &str, bracketed_paste: bool) -> Result<Vec<u8>, String> {
    let clean = sanitize(text);
    if bracketed_paste {
        return Ok(format!("{PASTE_START}{clean}{PASTE_END}").into_bytes());
    }
    if clean.contains('\r') {
        return Err(
            "multi-line text needs bracketed paste, which the application has not enabled".into(),
        );
    }
    Ok(clean.into_bytes())
}

pub fn encode_key(key: &str, application_cursor: bool) -> Result<Vec<u8>, String> {
    let arrow = |c: char| match application_cursor {
        true => format!("\x1bO{c}"),
        false => format!("\x1b[{c}"),
    };
    let seq = match key {
        "Enter" => "\r".to_string(),
        "Escape" | "Esc" => "\x1b".to_string(),
        "Tab" => "\t".to_string(),
        "BTab" | "S-Tab" => "\x1b[Z".to_string(),
        "Backspace" => "\x7f".to_string(),
        "Space" => " ".to_string(),
        "Up" => arrow('A'),
        "Down" => arrow('B'),
        "Right" => arrow('C'),
        "Left" => arrow('D'),
        _ => return encode_other(key),
    };
    Ok(seq.into_bytes())
}

fn encode_other(key: &str) -> Result<Vec<u8>, String> {
    let bytes = key.as_bytes();
    if bytes.len() == 3 && key.starts_with("C-") && bytes[2].is_ascii_alphabetic() {
        return Ok(vec![bytes[2].to_ascii_lowercase() - b'a' + 1]);
    }
    if bytes.len() == 1 && bytes[0].is_ascii_alphanumeric() {
        return Ok(bytes.to_vec());
    }
    Err(format!("unknown key {key}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bracketed_paste_wraps_text_and_maps_newlines_to_cr() {
        let out = encode_text("a\nb\r\nc", true).unwrap();
        assert_eq!(out, b"\x1b[200~a\rb\rc\x1b[201~");
    }

    #[test]
    fn text_cannot_smuggle_escape_or_paste_end() {
        let out = encode_text("x\x1b[201~\x03\x1b[Ay", true).unwrap();
        assert_eq!(
            String::from_utf8(out).unwrap(),
            "\x1b[200~x[201~[Ay\x1b[201~"
        );
    }

    #[test]
    fn raw_mode_refuses_multiline_but_allows_single_line() {
        assert!(encode_text("one\ntwo", false).is_err());
        assert_eq!(encode_text("hello", false).unwrap(), b"hello");
    }

    #[test]
    fn named_keys_follow_cursor_mode() {
        assert_eq!(encode_key("Up", false).unwrap(), b"\x1b[A");
        assert_eq!(encode_key("Up", true).unwrap(), b"\x1bOA");
        assert_eq!(encode_key("Enter", false).unwrap(), b"\r");
        assert_eq!(encode_key("Escape", false).unwrap(), b"\x1b");
        assert_eq!(encode_key("C-c", false).unwrap(), vec![3]);
        assert_eq!(encode_key("1", false).unwrap(), b"1");
        assert!(encode_key("C-[", false).is_err());
        assert!(encode_key("rm -rf", false).is_err());
    }
}
