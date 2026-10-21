// Screenshots are scaled down before they reach the model: a full-size PNG costs far more
// tokens, and coordinates in the reply are mapped back through the same scale.
pub const MAX_WIDTH: u32 = 1280;

pub struct Shot {
    pub png: Vec<u8>,
    pub width: u32,
    pub height: u32,
    // Screen pixels per screenshot pixel.
    pub scale: f64,
}

pub fn shrink(rgb: &[u8], width: u32, height: u32, max_width: u32) -> (Vec<u8>, u32, u32, f64) {
    if width <= max_width {
        return (rgb.to_vec(), width, height, 1.0);
    }
    let scale = width as f64 / max_width as f64;
    let (w, h) = (max_width, ((height as f64) / scale).round().max(1.0) as u32);
    let mut out = Vec::with_capacity((w * h * 3) as usize);
    for y in 0..h {
        let sy = ((y as f64 * scale) as u32).min(height - 1);
        for x in 0..w {
            let sx = ((x as f64 * scale) as u32).min(width - 1);
            let at = ((sy * width + sx) * 3) as usize;
            out.extend_from_slice(&rgb[at..at + 3]);
        }
    }
    (out, w, h, scale)
}

pub fn png(rgb: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    let mut encoder = png::Encoder::new(&mut out, width, height);
    encoder.set_color(png::ColorType::Rgb);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder.write_header().map_err(|e| e.to_string())?;
    writer.write_image_data(rgb).map_err(|e| e.to_string())?;
    writer.finish().map_err(|e| e.to_string())?;
    Ok(out)
}

pub fn shot(rgb: &[u8], width: u32, height: u32) -> Result<Shot, String> {
    let (small, w, h, scale) = shrink(rgb, width, height, MAX_WIDTH);
    Ok(Shot {
        png: png(&small, w, h)?,
        width: w,
        height: h,
        scale,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_wide_screen_shrinks_to_the_limit_and_encodes_as_png() {
        let (w, h) = (2560u32, 1440u32);
        let rgb = vec![200u8; (w * h * 3) as usize];
        let s = shot(&rgb, w, h).unwrap();
        assert_eq!((s.width, s.height), (1280, 720));
        assert_eq!(s.scale, 2.0);
        assert_eq!(&s.png[..8], b"\x89PNG\r\n\x1a\n");
        let small = shot(&[1, 2, 3], 1, 1).unwrap();
        assert_eq!((small.width, small.scale), (1, 1.0));
    }
}
