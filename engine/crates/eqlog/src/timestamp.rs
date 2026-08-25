//! `parseEqTimestamp` — "Sat Aug 01 13:00:28 2026" → epoch millis, IN HOST LOCAL TIME.
//!
//! THE TS SIDE REFORMATS AND HANDS THE RESULT TO `Date.parse`, which for a string with no zone
//! designator means LOCAL time (ECMA-262: an ISO string with no offset is UTC, but this is the
//! legacy-format path, and V8's legacy parser is local). So a golden is a fact about the machine
//! that recorded it — `goldens/manifest.json` records `America/Los_Angeles`, tzdata 2026b — and
//! this crate has to resolve the same wall clock through the same zone.
//!
//! THE BEFORE-TRANSITION RULE, implemented even though the corpus never exercises it. ECMA-262's
//! `LocalTZA(t, isUTC=true)` is where a local time that is AMBIGUOUS (the hour a fall-back repeats)
//! or SKIPPED (the hour a spring-forward deletes) gets its answer, and the spec's note — which V8
//! follows, verifiably: `new Date(2024, 2, 10, 2, 30)` in America/Los_Angeles is 10:30Z, i.e. read
//! at PST — is that BOTH cases use the offset in effect BEFORE the transition.
//!
//!   * AMBIGUOUS: chrono hands back two offsets, earliest-UTC first. The earlier UTC instant is the
//!     one reached through the pre-transition offset, so `earliest` IS the rule's answer.
//!   * SKIPPED: chrono hands back nothing, because no UTC instant maps to that wall clock. The
//!     pre-transition offset is read off a local time a day earlier — a transition is never two in
//!     one day, so that reading is unambiguous and is the offset the gap interrupted.
//!
//! The six slices span Jul–Aug 2026 and cross no Pacific transition, so neither branch runs on the
//! acceptance corpus; they are here because a live tail on a November Sunday will.

use crate::jsstr::{js_trim, JS_S};
use chrono::{Duration, LocalResult, NaiveDate, Offset, TimeZone};
use chrono_tz::Tz;
use regex::Regex;
use std::sync::OnceLock;

/// The host's IANA zone, or `UTC` when the platform will not name one. `parity --tz` overrides it.
pub fn host_timezone() -> Tz {
    iana_time_zone::get_timezone()
        .ok()
        .and_then(|n| n.parse::<Tz>().ok())
        .unwrap_or(Tz::UTC)
}

pub struct Clock {
    tz: Tz,
}

fn stamp_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // `^\w{3}\s+(\w{3})\s+(\d{1,2})\s+(\d{2}:\d{2}:\d{2})\s+(\d{4})$`, with JS's ASCII `\w`/`\d`
        // and JS's `\s` set spelled out (see jsstr.rs).
        Regex::new(&format!(
            r"^[0-9A-Za-z_]{{3}}{s}+([0-9A-Za-z_]{{3}}){s}+([0-9]{{1,2}}){s}+([0-9]{{2}}):([0-9]{{2}}):([0-9]{{2}}){s}+([0-9]{{4}})$",
            s = JS_S
        ))
        .unwrap()
    })
}

/// V8's legacy date parser recognizes month names by their first three letters, case-insensitively.
fn month_of(m: &str) -> Option<u32> {
    const MONTHS: [&str; 12] = [
        "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
    ];
    let lower = m.to_ascii_lowercase();
    MONTHS
        .iter()
        .position(|x| *x == lower)
        .map(|i| i as u32 + 1)
}

impl Clock {
    pub fn new(tz: Tz) -> Self {
        Clock { tz }
    }

    pub fn tz(&self) -> Tz {
        self.tz
    }

    /// `parseEqTimestamp`. A stamp the pattern declines, or a date V8 would call NaN, is 0 —
    /// which the TS spells as `Number.isNaN(t) ? 0 : t` on both of its two paths.
    pub fn parse_eq_timestamp(&self, stamp: &str) -> i64 {
        let t = js_trim(stamp);
        let Some(m) = stamp_re().captures(t) else {
            // The TS falls back to a bare `Date.parse(stamp)` here. Every timestamped line in the
            // EQ log matches the pattern above (asserted by the parity comparator, which reports a
            // non-zero count of unmatched stamps), so this crate answers 0 rather than shipping a
            // second, partial implementation of V8's legacy date grammar.
            let _ = t;
            return 0;
        };
        let Some(month) = month_of(&m[1]) else {
            return 0;
        };
        let day: u32 = m[2].parse().unwrap_or(0);
        let hour: u32 = m[3].parse().unwrap_or(99);
        let min: u32 = m[4].parse().unwrap_or(99);
        let sec: u32 = m[5].parse().unwrap_or(99);
        let year: i32 = m[6].parse().unwrap_or(0);
        let Some(date) = NaiveDate::from_ymd_opt(year, month, day) else {
            return 0;
        };
        let Some(naive) = date.and_hms_opt(hour, min, sec) else {
            return 0;
        };
        match self.tz.offset_from_local_datetime(&naive) {
            LocalResult::Single(off) => (naive - off.fix()).and_utc().timestamp_millis(),
            // The repeated hour: the earlier of the two offsets is the pre-transition one.
            LocalResult::Ambiguous(before, _after) => {
                (naive - before.fix()).and_utc().timestamp_millis()
            }
            // The skipped hour: read the pre-transition offset off the previous day.
            LocalResult::None => {
                let probe = naive - Duration::hours(24);
                let off = match self.tz.offset_from_local_datetime(&probe) {
                    LocalResult::Single(o) => o.fix(),
                    LocalResult::Ambiguous(o, _) => o.fix(),
                    LocalResult::None => self.tz.offset_from_utc_datetime(&naive).fix(),
                };
                (naive - off).and_utc().timestamp_millis()
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn la() -> Clock {
        Clock::new(chrono_tz::America::Los_Angeles)
    }

    #[test]
    fn reads_the_slice_corpus_shape() {
        // The first line of the patch-week golden: [Wed Aug 19 16:21:47 2026] → 1787181707000.
        assert_eq!(
            la().parse_eq_timestamp("Wed Aug 19 16:21:47 2026"),
            1787181707000
        );
    }

    #[test]
    fn a_stamp_that_is_not_one_is_zero() {
        assert_eq!(la().parse_eq_timestamp("not a timestamp"), 0);
        assert_eq!(la().parse_eq_timestamp("Sat Zzz 01 13:00:28 2026"), 0);
    }

    #[test]
    fn the_skipped_hour_reads_at_the_offset_before_the_transition() {
        // 2026-03-08 02:30 does not exist in America/Los_Angeles. ECMA-262 says read it at PST
        // (-08:00), which lands on 10:30Z — the same answer V8 gives for `new Date(y,m,d,2,30)`.
        let ms = la().parse_eq_timestamp("Sun Mar 08 02:30:00 2026");
        assert_eq!(ms, 1772965800000);
    }

    #[test]
    fn the_repeated_hour_reads_at_the_offset_before_the_transition() {
        // 2026-11-01 01:30 happens twice. The rule takes PDT (-07:00) → 08:30Z.
        let ms = la().parse_eq_timestamp("Sun Nov 01 01:30:00 2026");
        assert_eq!(ms, 1793521800000);
    }
}
