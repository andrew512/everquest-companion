//! THE ENGINE MEASURES ITS OWN SERVE PATH (owner ruling 19, foundations).
//!
//! > "the performance chip should incl perf of the server in end state."
//!
//! Surface 8 (`perf.budgets` / `perf.timeline`) is a later ticket. What must exist NOW is the
//! measurement DISCIPLINE, so that the surface has real numbers to serve rather than a place to put
//! numbers nobody took — and so that the first time the serve path is slow, the engine says so
//! instead of the owner noticing. Two things are counted, and they are the two the ruling names:
//!
//! * **Fold-to-frame latency, per source.** From the instant the ingest folded the event that moved
//!   the source, to the instant the frame describing it was handed to the connection's outbox. It
//!   is the whole engine-side path — drain, cadence, build, filter, sort, cut, diff, serialize —
//!   and it is measured rather than modelled. A frame that reports no new event (the fresh reset a
//!   just-opened subscription is owed) carries no latency, because there is no fold instant behind
//!   it and a number invented there would be the age of the session.
//! * **Diff size, per subscription.** How many ops a frame carried and how many BYTES it was on
//!   the wire, counted from the frame's own serialization. That is the payload-budget instrument
//!   ruling 4 asks for: the renderer never munges because the engine sends what the pixel needs,
//!   and "what the pixel needs" is only a discipline if somebody is weighing it.
//!
//! WHAT IT COSTS. One `serde_json::to_string` per frame that is actually sent — the frame is
//! serialized again by the transport, so this is a second pass over a payload bounded by
//! `views::MAX_LIMIT` rows, on the ingest thread, at most ten times a second. That is the honest
//! price of knowing the number, and it is paid only when something was sent.
//!
//! WHERE IT GOES. A stderr line, tagged like every other diagnostic, at most one per source per
//! [`REPORT_EVERY`] and only when there is something to report — plus one forced line when the
//! fold lands, because the first frame after a fold is the measurement anybody debugging a slow
//! Views tab wants first. Nothing here is on the wire: this is the foundation the `perf.budgets`
//! surface is built on, not the surface.

use std::collections::BTreeMap;
use std::time::{Duration, Instant};

/// The floor between two summary lines. Long enough that a live session's stderr stays readable,
/// short enough that a run worth watching says something while you are watching it.
pub const REPORT_EVERY: Duration = Duration::from_secs(10);

/// Which kind of frame was served.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrameKind {
    /// A full window — a subscription's first, or the one a landed fold owes it.
    Reset,
    /// A coalesced batch of ops.
    Diff,
}

/// What one source's serve path has cost so far, in this generation.
#[derive(Debug, Default, Clone, Copy)]
struct SourceStats {
    resets: u64,
    diffs: u64,
    rows: u64,
    ops: u64,
    bytes: u64,
    widest: usize,
    /// Frames that had a fold instant behind them, and what they took.
    timed: u64,
    latency_total: Duration,
    latency_worst: Duration,
}

/// The engine's own serve-path counters. One per attach — a new fold is a new world, and a
/// measurement of the last one is not a measurement of this one.
pub struct Meter {
    sources: BTreeMap<&'static str, SourceStats>,
    /// When the last summary line was printed, or `None` when none has been.
    said: Option<Instant>,
    /// Whether anything has been counted since that line.
    fresh: bool,
}

impl Default for Meter {
    fn default() -> Self {
        Self::new()
    }
}

impl Meter {
    /// A fresh set of counters.
    #[must_use]
    pub fn new() -> Self {
        Self {
            sources: BTreeMap::new(),
            said: None,
            fresh: false,
        }
    }

    /// Count one frame that was actually sent.
    ///
    /// `since` is the instant the fold produced what this frame reports, or `None` when the frame
    /// is not reporting a fold at all (see the module header).
    pub fn frame(
        &mut self,
        source: &'static str,
        kind: FrameKind,
        rows: usize,
        ops: usize,
        bytes: usize,
        since: Option<Instant>,
    ) {
        let stats = self.sources.entry(source).or_default();
        match kind {
            FrameKind::Reset => stats.resets += 1,
            FrameKind::Diff => stats.diffs += 1,
        }
        stats.rows += rows as u64;
        stats.ops += ops as u64;
        stats.bytes += bytes as u64;
        stats.widest = stats.widest.max(bytes);
        if let Some(folded_at) = since {
            let took = folded_at.elapsed();
            stats.timed += 1;
            stats.latency_total += took;
            stats.latency_worst = stats.latency_worst.max(took);
        }
        self.fresh = true;
    }

    /// The summary lines owed right now, or nothing.
    ///
    /// `force` prints whatever there is regardless of the cadence — what a landing fold does, so
    /// the first frames of a generation are always reported.
    pub fn take_report(&mut self, force: bool) -> Vec<String> {
        if !self.fresh {
            return Vec::new();
        }
        let due = force || self.said.is_none_or(|last| last.elapsed() >= REPORT_EVERY);
        if !due {
            return Vec::new();
        }
        self.said = Some(Instant::now());
        self.fresh = false;
        self.sources
            .iter()
            .map(|(source, stats)| line(source, stats))
            .collect()
    }
}

/// One source's line. Cumulative for the generation, so two lines read as a progression rather
/// than as two disconnected samples.
fn line(source: &str, stats: &SourceStats) -> String {
    let frames = stats.resets + stats.diffs;
    let mean = if stats.timed == 0 {
        String::from("n/a")
    } else {
        took(stats.latency_total / u32::try_from(stats.timed).unwrap_or(u32::MAX))
    };
    format!(
        "views: {source} {frames} frames ({} reset / {} diff), {} rows, {} ops, {} B (widest {} B); \
         fold->frame mean {mean} max {} over {}",
        stats.resets,
        stats.diffs,
        stats.rows,
        stats.ops,
        stats.bytes,
        stats.widest,
        took(stats.latency_worst),
        stats.timed,
    )
}

/// A duration a person reads, at a precision that does not throw the measurement away.
///
/// MICROSECONDS UNDER A MILLISECOND, and that is the whole reason this is not one format string:
/// cutting a fifty-row window off a fold takes tens of microseconds, and a serve path that reports
/// `0.0 ms` reads as a measurement nobody took rather than as the good news it is.
fn took(d: Duration) -> String {
    let ms = d.as_secs_f64() * 1000.0;
    if ms < 1.0 {
        format!("{} us", d.as_micros())
    } else {
        format!("{ms:.1} ms")
    }
}

#[cfg(test)]
mod tests {
    use super::{FrameKind, Meter, REPORT_EVERY};
    use std::time::Instant;

    #[test]
    fn a_meter_that_counted_nothing_says_nothing() {
        let mut meter = Meter::new();
        assert!(meter.take_report(true).is_empty());
    }

    #[test]
    fn the_line_carries_both_measurements_the_ruling_names() {
        let mut meter = Meter::new();
        meter.frame(
            "loot.ledger",
            FrameKind::Reset,
            50,
            0,
            4096,
            Some(Instant::now()),
        );
        meter.frame(
            "loot.ledger",
            FrameKind::Diff,
            0,
            2,
            310,
            Some(Instant::now()),
        );
        let [line] = meter.take_report(true).try_into().expect("one source");
        assert!(line.contains("loot.ledger"), "{line}");
        assert!(line.contains("2 frames (1 reset / 1 diff)"), "{line}");
        assert!(line.contains("2 ops"), "{line}");
        assert!(line.contains("widest 4096 B"), "{line}");
        assert!(line.contains("fold->frame"), "{line}");
    }

    #[test]
    fn a_frame_with_no_fold_behind_it_is_counted_but_not_timed() {
        // The fresh reset a just-opened subscription is owed on an idle session. Timing it against
        // the last event would report the age of the session as a serve latency.
        let mut meter = Meter::new();
        meter.frame("loot.ledger", FrameKind::Reset, 3, 0, 200, None);
        let [line] = meter.take_report(true).try_into().expect("one source");
        assert!(line.contains("mean n/a"), "{line}");
        assert!(line.contains("over 0"), "{line}");
    }

    #[test]
    fn the_cadence_holds_the_second_line_back_and_a_forced_one_gets_through() {
        let mut meter = Meter::new();
        meter.frame("loot.ledger", FrameKind::Diff, 0, 1, 100, None);
        assert_eq!(meter.take_report(false).len(), 1, "the first line is due");
        meter.frame("loot.ledger", FrameKind::Diff, 0, 1, 100, None);
        assert!(
            meter.take_report(false).is_empty(),
            "the cadence is {REPORT_EVERY:?} and no time has passed"
        );
        assert_eq!(
            meter.take_report(true).len(),
            1,
            "a forced line gets through"
        );
        // …and a forced line with nothing new behind it still says nothing.
        assert!(meter.take_report(true).is_empty());
    }
}
