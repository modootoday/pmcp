use std::time::{SystemTime, UNIX_EPOCH};

/// RFC 3339 UTC with millisecond precision, without a date-time dependency.
pub fn utc_iso(t: SystemTime) -> String {
    let d = t.duration_since(UNIX_EPOCH).unwrap_or_default();
    let secs = d.as_secs();
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = match mp < 10 {
        true => mp + 3,
        false => mp - 9,
    };
    let year = yoe + era * 400 + i64::from(month <= 2);
    let (h, m, s) = (rem / 3600, rem % 3600 / 60, rem % 60);
    format!(
        "{year:04}-{month:02}-{day:02}T{h:02}:{m:02}:{s:02}.{:03}Z",
        d.subsec_millis()
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn utc_iso_formats_known_instants() {
        assert_eq!(utc_iso(UNIX_EPOCH), "1970-01-01T00:00:00.000Z");
        let t = UNIX_EPOCH + Duration::from_millis(1_792_477_535_123);
        assert_eq!(utc_iso(t), "2026-10-20T06:25:35.123Z");
        let leap = UNIX_EPOCH + Duration::from_secs(951_782_400);
        assert_eq!(utc_iso(leap), "2000-02-29T00:00:00.000Z");
    }
}
