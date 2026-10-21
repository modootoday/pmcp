use regex::Regex;
use std::collections::VecDeque;
use std::sync::OnceLock;

pub struct Ring {
    buf: VecDeque<u8>,
    cap: usize,
}

impl Ring {
    pub fn new(cap: usize) -> Ring {
        Ring {
            buf: VecDeque::with_capacity(cap.min(1 << 20)),
            cap,
        }
    }

    pub fn push(&mut self, data: &[u8]) {
        let data = &data[data.len().saturating_sub(self.cap)..];
        let overflow = (self.buf.len() + data.len()).saturating_sub(self.cap);
        self.buf.drain(..overflow);
        self.buf.extend(data);
    }

    pub fn tail(&self, n: usize) -> Vec<u8> {
        let skip = self.buf.len().saturating_sub(n);
        self.buf.iter().skip(skip).copied().collect()
    }
}

pub fn strip_ansi(text: &str) -> String {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| {
        Regex::new(r"\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[0-~]")
            .expect("ansi regex")
    });
    re.replace_all(text, "").into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ring_keeps_only_the_last_cap_bytes() {
        let mut r = Ring::new(5);
        r.push(b"abc");
        r.push(b"defg");
        assert_eq!(r.tail(100), b"cdefg");
        r.push(b"0123456789");
        assert_eq!(r.tail(3), b"789");
    }

    #[test]
    fn strip_ansi_removes_csi_osc_and_short_escapes() {
        assert_eq!(
            strip_ansi("\x1b[1;31mred\x1b[0m \x1b]0;title\x07ok\x1b="),
            "red ok"
        );
    }
}
