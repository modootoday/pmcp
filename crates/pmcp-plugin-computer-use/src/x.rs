use std::collections::HashMap;
use std::os::unix::net::UnixStream;
use x11rb::connection::Connection;
use x11rb::protocol::xproto::{ConnectionExt as _, ImageFormat, Window};
use x11rb::protocol::xtest::ConnectionExt as _;
use x11rb::rust_connection::{DefaultStream, RustConnection};
use x11rb::wrapper::ConnectionExt as _;

// XTEST event types: what a real keyboard and mouse would send, so every client sees input.
const KEY_PRESS: u8 = 2;
const KEY_RELEASE: u8 = 3;
const BUTTON_PRESS: u8 = 4;
const BUTTON_RELEASE: u8 = 5;
const MOTION: u8 = 6;
const SHIFT: u32 = 0xffe1;

pub struct X {
    conn: RustConnection,
    root: Window,
    pub width: u16,
    pub height: u16,
    // keysym -> (keycode, needs shift), learnt from the server and from spare keycodes we bound.
    keys: HashMap<u32, (u8, bool)>,
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

impl X {
    pub fn connect(display: u16, cookie: &[u8]) -> Result<X, String> {
        let unix = UnixStream::connect(format!("/tmp/.X11-unix/X{display}")).map_err(err)?;
        let (stream, _) = DefaultStream::from_unix_stream(unix).map_err(err)?;
        let conn = RustConnection::connect_to_stream_with_auth_info(
            stream,
            0,
            b"MIT-MAGIC-COOKIE-1".to_vec(),
            cookie.to_vec(),
        )
        .map_err(err)?;
        let screen = &conn.setup().roots[0];
        let (root, width, height) = (screen.root, screen.width_in_pixels, screen.height_in_pixels);
        conn.xtest_get_version(2, 2)
            .map_err(err)?
            .reply()
            .map_err(err)?;
        let mut x = X {
            conn,
            root,
            width,
            height,
            keys: HashMap::new(),
        };
        x.learn_keys()?;
        Ok(x)
    }

    fn learn_keys(&mut self) -> Result<(), String> {
        let (min, max) = (self.conn.setup().min_keycode, self.conn.setup().max_keycode);
        let map = self
            .conn
            .get_keyboard_mapping(min, max - min + 1)
            .map_err(err)?
            .reply()
            .map_err(err)?;
        let per = map.keysyms_per_keycode as usize;
        for (i, syms) in map.keysyms.chunks(per).enumerate() {
            for (level, sym) in syms.iter().take(2).enumerate() {
                if *sym != 0 {
                    self.keys.entry(*sym).or_insert((min + i as u8, level == 1));
                }
            }
        }
        Ok(())
    }

    // A keysym the keyboard map lacks (a CJK letter, say) is bound to a spare keycode once.
    fn keycode(&mut self, sym: u32) -> Result<(u8, bool), String> {
        if let Some(found) = self.keys.get(&sym) {
            return Ok(*found);
        }
        let (min, max) = (self.conn.setup().min_keycode, self.conn.setup().max_keycode);
        let map = self
            .conn
            .get_keyboard_mapping(min, max - min + 1)
            .map_err(err)?
            .reply()
            .map_err(err)?;
        let per = map.keysyms_per_keycode as usize;
        let spare = map
            .keysyms
            .chunks(per)
            .rposition(|syms| syms.iter().all(|s| *s == 0))
            .ok_or("no spare keycode to bind a character to")?;
        let code = min + spare as u8;
        let syms = vec![sym; per];
        self.conn
            .change_keyboard_mapping(1, code, per as u8, &syms)
            .map_err(err)?;
        self.conn.sync().map_err(err)?;
        self.keys.insert(sym, (code, false));
        Ok((code, false))
    }

    fn fake(&self, kind: u8, detail: u8, x: i16, y: i16) -> Result<(), String> {
        self.conn
            .xtest_fake_input(kind, detail, 0, self.root, x, y, 0)
            .map_err(err)?;
        Ok(())
    }

    pub fn flush(&self) -> Result<(), String> {
        self.conn.sync().map_err(err)
    }

    pub fn move_to(&self, x: i16, y: i16) -> Result<(), String> {
        self.fake(MOTION, 0, x, y)
    }

    pub fn button(&self, button: u8, press: bool) -> Result<(), String> {
        let kind = if press { BUTTON_PRESS } else { BUTTON_RELEASE };
        self.fake(kind, button, 0, 0)
    }

    pub fn key(&mut self, sym: u32, press: bool) -> Result<(), String> {
        let (code, _) = self.keycode(sym)?;
        let kind = if press { KEY_PRESS } else { KEY_RELEASE };
        self.fake(kind, code, 0, 0)
    }

    /// Types one character, with Shift when the keyboard map puts it on the second level.
    pub fn char(&mut self, c: char) -> Result<(), String> {
        let sym = crate::keys::char_keysym(c);
        let (code, shift) = self.keycode(sym)?;
        if shift {
            self.key(SHIFT, true)?;
        }
        self.fake(KEY_PRESS, code, 0, 0)?;
        self.fake(KEY_RELEASE, code, 0, 0)?;
        if shift {
            self.key(SHIFT, false)?;
        }
        Ok(())
    }

    pub fn pointer(&self) -> Result<(i16, i16), String> {
        let p = self
            .conn
            .query_pointer(self.root)
            .map_err(err)?
            .reply()
            .map_err(err)?;
        Ok((p.root_x, p.root_y))
    }

    /// The whole screen as RGB, from the server's 32-bit little-endian BGRX pixels.
    pub fn capture(&self) -> Result<Vec<u8>, String> {
        let image = self
            .conn
            .get_image(
                ImageFormat::Z_PIXMAP,
                self.root,
                0,
                0,
                self.width,
                self.height,
                !0,
            )
            .map_err(err)?
            .reply()
            .map_err(err)?;
        if image.depth < 24 || image.data.len() < self.width as usize * self.height as usize * 4 {
            return Err(format!("unsupported screen depth {}", image.depth));
        }
        let (pixels, _) = image.data.as_chunks::<4>();
        Ok(pixels.iter().flat_map(|p| [p[2], p[1], p[0]]).collect())
    }
}
