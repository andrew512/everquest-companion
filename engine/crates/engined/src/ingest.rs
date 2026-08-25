//! ============================================================================
//! INGEST — WHAT AN ATTACH ACTUALLY DOES (JOS-459 phase 2/3 seam, JOS-474).
//! ============================================================================
//!
//! One thread per attach: open the log, SCAN it at full speed, then TAIL it live, handing every
//! event to one [`EventSink`]. `eqlog` supplies the two halves and the line law between them
//! (JOS-469 proved the scan byte-identical to the TS parser; JOS-472 proved the tail's line
//! sequence equal to the scan's under any chunking at all), so nothing here re-decides what an
//! event is. This module decides only WHO IS FOLDING, WHEN IT STOPS, and WHAT IT SAYS ABOUT ITSELF.
//!
//! ## THE GENERATION LAW (JOS-457, promoted to protocol law by the schema)
//!
//! An attach PREEMPTS any in-flight attach. Last pick wins; intermediate picks are DROPPED, never
//! queued. This is `src/main/switchController.ts`'s `owns()` moved engine-side, and it is a
//! GENERATION rather than a queue or a mutex for the reason that file states at length: a queue
//! turns six impatient clicks into six sequential full folds (the lock-up with better manners), and
//! a counter can only ever say "you are not the current answer any more", which is the one question
//! every statement in a switch needs to ask.
//!
//! The in-flight scan asks it at its SLICE BOUNDARIES — once per read, never per line — and when
//! the answer is no it returns, having touched nothing. Silently: a loser has nothing to report, and
//! a diagnostic per preempted attach would print six lines for a storm of six clicks.
//!
//! **NO EVENT CAN INTERLEAVE, STRUCTURALLY.** Each attach builds its OWN sink and its OWN parser and
//! folds into nothing else; a loser's sink is dropped with its thread. Two folds cannot reach one
//! set of modules because there is only ever one set per attach — which is precisely the class of
//! defect JOS-457 was (character A's history landing in character B's freshly reset modules), made
//! impossible by construction rather than by ordering.
//!
//! ## THE SINK IS THE PHASE-2a SEAM
//!
//! Ingest terminates in a trait object. Today that is [`CountingSink`] — events in, a counter out.
//! When the fold registry (JOS-471, `engine/crates/fold`) lands, the only edit is the CONSTRUCTION:
//! one `impl EventSink for …` (which must live in this crate anyway, by the orphan rule) and one
//! [`SinkFactory`] handed to [`starter`] in `main.rs`. The ingest loops, the generation law, the
//! progress cadence and the mark do not move. See the crate README's "The sink seam" for the
//! drop-in recipe.
//!
//! THE EVENT IS ITS SERIALIZED JSON, and that is not laziness: `eqlog::event::Ev` writes an event
//! key by key in the TS's insertion order because the phase-1 bar is byte identity with
//! `JSON.stringify(ev)` (there is no struct-per-kind to hand over — there is a struct per BRANCH,
//! and the ordering claim lives in the branch). A fold that wants fields parses the line it is
//! given, exactly as `session.ts` hands `Tailer`'s line to the parser today.
//!
//! ## WHAT READS A CLOCK, AND WHAT MAY NOT (ruling 18 law 1)
//!
//! Nothing event-derived reads a wall clock. `pct` is bytes over bytes; `events` is a count; the
//! mark is a byte offset; `lastTs` is the LOG's own timestamp. There are exactly two [`Instant`]s
//! here and both are process metadata in the sense `world.rs` means it for `uptimeMs`: one paces
//! the PROGRESS CADENCE — how often a measurement is announced, never what it measures, and a frame
//! that is skipped changes no state at all — and one times the spell-DB build for a stderr
//! diagnostic. Neither can reach a sink.

use std::fs::File;
use std::io::{self, Read};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use protocol::generated::HealthResultStatus;

use eqlog::event::Ev;
use eqlog::parse::Parser;
use eqlog::tail::{FileTail, TailCore, TailStart, DEFAULT_POLL_INTERVAL, LIVE};
use eqlog::{host_timezone, spelldb, Clock};

use crate::spawn::DIAGNOSTIC_PREFIX;
use crate::world::{FoldMark, World};

/// How many bytes one scan read asks for.
///
/// THE SCAN IS DELIBERATELY IMPOLITE — no yield, no throttle, no slice sleep. That is the whole
/// point of the process boundary (docs/plans/data-server.md, "Why"): the fold used to be throttled
/// to 60% of one core because it shared a thread with the UI, and the fix the owner ruled on is a
/// boundary rather than another throttle. The tail keeps `eqlog`'s 256 KiB slicing, because THAT
/// one is about EverQuest's synchronous append and not about this process's manners.
///
/// The size is a buffer, not a promise: `Read::read` may hand back less. It is also the granularity
/// at which the generation is polled and progress may be announced, which is why it is big enough
/// to amortize a read and small enough that a preempted fold abandons within milliseconds.
const SCAN_READ_BYTES: usize = 1 << 20;

/// The floor between two progress announcements — "~4/s max, never per-line".
///
/// A cadence rather than a count: an events-based cadence would announce a hundred frames a second
/// on a dense raid slice and none at all on a quiet one.
const PROGRESS_EVERY: Duration = Duration::from_millis(250);

/// The longest prefix of an event's JSON that is searched for its timestamp. See [`ts_of`].
const TS_SCAN_BYTES: usize = 128;

/// The nap the tail loop sleeps in, so a preempted tail notices promptly instead of after a whole
/// poll interval. Mirrors `FileTail::follow`'s own nap.
const TAIL_NAP: Duration = Duration::from_millis(25);

/// One folded event, as the ingest hands it to a sink.
///
/// Borrowed, never owned: the JSON lives in the parser's reused buffer and is valid for exactly
/// this call. A sink that needs to keep it copies it — which makes the copy the sink's decision,
/// stated at the place that pays for it.
pub struct Event<'a> {
    /// The event, serialized. Byte-identical to the TS pipeline's `JSON.stringify(ev)` (JOS-469).
    pub json: &'a str,
    /// The event's sequence number. Counts EVENTS, not lines, and starts at 0 for each attach.
    pub seq: i64,
    /// `false` for the historical scan, `true` for the live tail. A property of the SOURCE, not of
    /// the line — `eqlog::tail::LIVE` is the constant this stamps for the tail half.
    pub live: bool,
}

/// WHERE INGEST ENDS. The phase-2a seam: one trait, events in.
///
/// The fold registry implements this (in an `impl` block in THIS crate — the orphan rule requires
/// it, and it is the whole extent of the edit); its factory reaches the world as
/// `World::with_ingest(ingest::starter(<factory>))`. Nothing else about ingest changes when it
/// arrives.
pub trait EventSink: Send {
    /// One event, in emission order. Called once per event, on the ingest thread, and on no other.
    fn event(&mut self, event: &Event<'_>);

    /// What this sink can say about itself.
    ///
    /// Defaulted because a fold registry's answer is its own state and it may have nothing to add:
    /// the ingest counts events itself (an engine-measured fact about the FOLD, not about the sink)
    /// and only merges what a sink volunteers.
    fn report(&self) -> SinkReport {
        SinkReport::default()
    }
}

/// What a sink volunteers about itself.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct SinkReport {
    /// Events this sink has taken.
    pub events: i64,
    /// How many of them arrived LIVE. The split between "this came out of history" and "this is
    /// happening now" is the one a loading UI and a bug report both want, and it is free here.
    pub live_events: i64,
    /// The `seq` of the last event taken. Reported rather than derived from `events`: they are the
    /// same number only for a sink that keeps everything, and a fold that declines an event is
    /// exactly the case where the difference matters.
    pub last_seq: Option<i64>,
    /// The `ts` of the last event taken — THE LOG'S OWN CLOCK, never the host's.
    pub last_ts: Option<i64>,
}

/// The phase-now sink: a counter, and nothing else.
///
/// It is not a placeholder for a fold so much as the honest floor under one — `session.health` can
/// say how much has been folded and how far into the log's own time it reached without any module
/// existing yet.
#[derive(Debug, Default)]
pub struct CountingSink {
    events: i64,
    live_events: i64,
    last_seq: Option<i64>,
    last_ts: Option<i64>,
}

impl EventSink for CountingSink {
    fn event(&mut self, event: &Event<'_>) {
        self.events += 1;
        if event.live {
            self.live_events += 1;
        }
        self.last_seq = Some(event.seq);
        // A STAMP THAT CANNOT BE READ IS NOT A ZERO. The last one that could be read stands, which
        // keeps `lastTs` monotonic over a log that holds a line the timestamp pattern declines.
        if let Some(ts) = ts_of(event.json) {
            self.last_ts = Some(ts);
        }
    }

    fn report(&self) -> SinkReport {
        SinkReport {
            events: self.events,
            live_events: self.live_events,
            last_seq: self.last_seq,
            last_ts: self.last_ts,
        }
    }
}

/// Builds the sink one attach folds into. THE CONSTRUCTION SEAM — see [`EventSink`].
pub type SinkFactory = Arc<dyn Fn() -> Box<dyn EventSink> + Send + Sync>;

/// The factory a plain engine uses.
#[must_use]
pub fn counting_sinks() -> SinkFactory {
    Arc::new(|| Box::new(CountingSink::default()))
}

/// What [`World`] does when an attach is accepted: begin folding this log, under this generation.
///
/// The world holds one of these rather than a sink factory so that WHAT AN ATTACH STARTS is a
/// single injected decision. Production hands it [`starter`]; `world.rs`'s own unit tests hand it a
/// no-op, which is how the epoch and subscription laws are proven without a fold in the room.
pub type Starter = Arc<dyn Fn(&World, u64, PathBuf) + Send + Sync>;

/// The starter a real engine uses: one ingest thread per attach, folding into `sinks`.
#[must_use]
pub fn starter(sinks: SinkFactory) -> Starter {
    Arc::new(move |world, generation, log| start(world, generation, log, sinks()))
}

/// The starter [`World::new`](crate::world::World::new) uses — counting sinks, nothing folded.
#[must_use]
pub fn default_starter() -> Starter {
    starter(counting_sinks())
}

/// Read an event's `ts` back out of its serialized form.
///
/// A SCAN OF A BOUNDED PREFIX, and it is exact rather than a heuristic: `Ev::envelope` writes
/// `seq`, `ts`, `raw` in that order and the only kind that writes anything AHEAD of the envelope is
/// `group` (a short `change` string), so the first `"ts":` in an event is always the envelope's and
/// always well inside [`TS_SCAN_BYTES`]. The `raw` line — the only field that could contain a
/// counterfeit — is written after it, every time.
///
/// Bytes, not `str`, so a prefix cut cannot land inside a multi-byte character and panic.
fn ts_of(json: &str) -> Option<i64> {
    const KEY: &[u8] = b"\"ts\":";
    let bytes = json.as_bytes();
    let head = &bytes[..bytes.len().min(TS_SCAN_BYTES)];
    let at = head.windows(KEY.len()).position(|w| w == KEY)?;
    let mut i = at + KEY.len();
    let negative = head.get(i) == Some(&b'-');
    if negative {
        i += 1;
    }
    let first_digit = i;
    let mut value: i64 = 0;
    while let Some(&b) = head.get(i) {
        if !b.is_ascii_digit() {
            break;
        }
        value = value.checked_mul(10)?.checked_add(i64::from(b - b'0'))?;
        i += 1;
    }
    if i == first_digit {
        return None;
    }
    Some(if negative { -value } else { value })
}

/// The character whose log this is, from the FILE NAME.
///
/// THE NAME IS LOAD-BEARING and must be known before the fold starts: the self-`/who` rule and the
/// pet-leader carve-out both decline every line until it is set (`eqlog::parser_for` says so, and
/// `session.ts` arranges the same order app-side). The engine derives it rather than being told it,
/// because the log's identity and the character's identity are the same fact and two ways of
/// stating it is a way for them to disagree.
///
/// TWO SHAPES, and the second is `eqlog`'s: the product's own `eqlog_<Name>_<server>.txt`, and the
/// oracle corpus's slice form `eqlog_<Name>_<server>.<slice>.txt`, which
/// [`eqlog::character_of`] already implements as `goldenOracle.mts characterOf` does. Anything else
/// yields `None`, and a parser with no character is the honest result — not a guess.
#[must_use]
pub fn character_of(log: &Path) -> Option<String> {
    let name = log.file_name()?.to_string_lossy().into_owned();
    if let Some(character) = eqlog::character_of(&name) {
        return Some(character);
    }
    let stem = name.get(..name.len().checked_sub(4)?)?;
    if !name[stem.len()..].eq_ignore_ascii_case(".txt") {
        return None;
    }
    let head = stem.get(..6)?;
    if !head.eq_ignore_ascii_case("eqlog_") {
        return None;
    }
    let rest = stem.get(6..)?;
    // The LAST underscore separates the character from the server, which is also how eqlog's
    // regex resolves (`([^_]+?)` cannot hold one) — stated the same way in two places on purpose.
    let split = rest.rfind('_')?;
    let (character, server) = (&rest[..split], &rest[split + 1..]);
    if character.is_empty() || server.is_empty() {
        return None;
    }
    Some(character.to_owned())
}

/// How an ingest ended, when it ended without an error.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Ended {
    /// A newer attach took the world. The loser touched nothing and said nothing.
    Preempted,
}

/// Start one attach's ingest on its own thread.
///
/// A FAILURE TO SPAWN IS NOT A DEAD ENGINE. The epoch has already been bumped and announced; all
/// that is left is to say the world holds no fold, which is what `idle` means.
pub fn start(world: &World, generation: u64, log: PathBuf, sink: Box<dyn EventSink>) {
    let owner = world.clone();
    let spawned = thread::Builder::new()
        .name("engined-ingest".to_owned())
        .spawn(move || {
            // A PANICKING FOLD MUST NOT TAKE THE PROCESS. One bad line, one unwrap somebody adds in
            // phase 2, must cost the fold and nothing else — the same blast-radius argument
            // `World::lock` makes for a poisoned mutex, and the same one that put the fold in
            // another process to begin with. The epoch is untouched: a fold that died did not
            // create a new generation, and the client's state is still the one it was told about.
            let ending = catch_unwind(AssertUnwindSafe(|| run(&owner, generation, &log, sink)));
            match ending {
                Ok(Ok(Ended::Preempted)) => {}
                Ok(Err(e)) => {
                    eprintln!(
                        "{DIAGNOSTIC_PREFIX} the ingest of {} ended: {e}",
                        log.display()
                    );
                    owner.report_idle(generation);
                }
                Err(_) => {
                    eprintln!(
                        "{DIAGNOSTIC_PREFIX} the ingest of {} PANICKED; the world is idle and the \
                         epoch is untouched",
                        log.display()
                    );
                    owner.report_idle(generation);
                }
            }
        });
    if let Err(e) = spawned {
        eprintln!("{DIAGNOSTIC_PREFIX} an ingest thread could not be started: {e}");
        world.report_idle(generation);
    }
}

/// Open the log, fold its history, then follow it. Returns when this turn no longer owns the world.
fn run(
    world: &World,
    generation: u64,
    log: &Path,
    mut sink: Box<dyn EventSink>,
) -> io::Result<Ended> {
    // ATTACHING is exactly "opening the file and building what a parse depends on" — it covers the
    // spell DB too, because a parse is a pure function of (bytes, spell DB, character) and the fold
    // has not begun until all three exist.
    if !world.report_status(generation, HealthResultStatus::Attaching) {
        return Ok(Ended::Preempted);
    }

    let character = character_of(log);
    if character.is_none() {
        eprintln!(
            "{DIAGNOSTIC_PREFIX} no character name in {}; the self-referential rules will decline \
             every line",
            log.display()
        );
    }
    // ONE SPELL DB PER ATTACH, and the honest note about it: it is a pure function of committed
    // data and ought to be built once per PROCESS, but `eqlog::Parser` owns its `SpellDb` by value
    // and `SpellDb` is neither `Clone` nor shareable, so a parser cannot be handed one that already
    // exists. Attaches are rare (a character switch) and the build is measured on the line below,
    // so the cost is visible rather than assumed. Closing it is a one-line change in eqlog, which
    // this ticket does not own — the crate README names it for the integrator.
    let building = Instant::now();
    let db = spelldb::load();
    eprintln!(
        "{DIAGNOSTIC_PREFIX} ingest: spell db built in {} ms",
        building.elapsed().as_millis()
    );
    let parser = Parser::new(Clock::new(host_timezone()), Some(db), character);

    let mut file = File::open(log)?;
    let size = file.metadata()?.len();

    if !world.report_status(generation, HealthResultStatus::Folding) {
        return Ok(Ended::Preempted);
    }

    // ---- the scan: the whole file, at full speed -------------------------------------------
    //
    // The line splitting is `eqlog::tail::TailCore`'s rather than `scan_bytes`'s, and the two are
    // the same law: JOS-472's oracle IS the claim that a tail's line sequence equals the scan's
    // over any chunking at all. Using the chunked one buys three things the whole-file one cannot
    // give: a 200 MB log is never a 200 MB allocation, the read cursor is a live measurement to
    // report progress from, and every read boundary is a place to ask who owns the world.
    let mut core = TailCore::at(0);
    let mut ev = Ev::new();
    let mut seq: i64 = 0;
    let mut buf = vec![0u8; SCAN_READ_BYTES];
    let mut cadence = Cadence::new();
    loop {
        let got = file.read(&mut buf)?;
        if got == 0 {
            break;
        }
        core.consume(&buf[..got], |line| {
            if parser.parse_event(line, seq, &mut ev) {
                sink.event(&Event {
                    json: ev.finish(),
                    seq,
                    live: false,
                });
                seq += 1;
            }
        });
        // THE SLICE BOUNDARY, and both of this loop's outward-facing acts happen here and nowhere
        // else: the generation poll, and at most one progress frame per cadence.
        if !world.owns(generation) {
            return Ok(Ended::Preempted);
        }
        if cadence.due() && !world.report_progress(generation, mark(&core, size, seq, &*sink)) {
            return Ok(Ended::Preempted);
        }
    }

    // THE FINAL MEASUREMENT IS NOT OPTIONAL and does not ask the cadence. It is the one frame that
    // states the whole fold — `pct` at its ceiling and the exact event count — and a client whose
    // loading bar depends on it must never lose it to a fold that finished inside one interval.
    let landed = mark(&core, size, seq, &*sink);
    if !world.report_progress(generation, landed) {
        return Ok(Ended::Preempted);
    }

    // ---- the fold lands ---------------------------------------------------------------------
    //
    // The handoff is `ScanResult.endOffset` → `TailStart::At`: the tail picks up at the end of the
    // last COMPLETE line the scan folded, so bytes appended DURING the scan are read rather than
    // skipped and none are read twice. That seam is the lossless one the architecture diagram
    // names, and the mark law (eqlog::tail's header) is what makes the arithmetic exact.
    if !world.report_fold_landed(generation, landed) {
        return Ok(Ended::Preempted);
    }
    // READ BACK THROUGH THE ONE DOOR, deliberately: this diagnostic is the only place the engine
    // states its own coordinate out loud, and it states the world's copy rather than the ingest's
    // local one — so a mark the world failed to record could not print as if it had.
    let recorded = world.mark();
    eprintln!(
        "{DIAGNOSTIC_PREFIX} fold landed: {} events, mark {} of {}, now live",
        recorded.events,
        recorded.checkpoint,
        recorded.log.as_deref().unwrap_or(log).display()
    );
    let mut tail = FileTail::open(log, TailStart::At(landed.checkpoint));

    // ---- the tail: live, until something newer takes the world ------------------------------
    //
    // WHAT HAS BEEN ANNOUNCED, not what has been folded. The cadence may DEFER a frame but must
    // never DROP one: an event whose arrival was announced by nobody is an event the client cannot
    // know about at all, and "the count did not change since the last poll" is not the same
    // question as "the count did not change since the last frame".
    let mut announced = seq;
    loop {
        if !world.owns(generation) {
            return Ok(Ended::Preempted);
        }
        let polled = tail.poll(|line| {
            if parser.parse_event(line, seq, &mut ev) {
                sink.event(&Event {
                    json: ev.finish(),
                    seq,
                    live: LIVE,
                });
                seq += 1;
            }
        });
        if let Err(e) = polled {
            // A FAILED POLL LEAVES THE TAIL RUNNING — `FileTail` drops its handle and the next
            // cycle opens a fresh one under a counted reason. This is `Tailer`'s `'error'` event
            // with the same contract, and ending the ingest here would turn a transient sharing
            // violation into a session that never sees another line.
            eprintln!(
                "{DIAGNOSTIC_PREFIX} a tail poll of {} failed: {e}",
                log.display()
            );
        }
        // A LIVE PROGRESS FRAME IS THE ONLY WIRE EVIDENCE A LIVE LINE LANDED until views arrive in
        // phase 3, so it is emitted when the fold ADVANCED and the cadence allows — never on an
        // idle poll, which is what keeps an idle session silent. `pct` stays honest: the mark over
        // the bytes read, which is 100 exactly when the game is not mid-line.
        if seq != announced && cadence.due() {
            let live_total = tail.read_offset();
            let advanced = FoldMark {
                checkpoint: tail.checkpoint_offset(),
                events: seq,
                pct: pct_of(tail.checkpoint_offset(), live_total),
                last_ts: sink.report().last_ts,
            };
            announced = seq;
            if !world.report_progress(generation, advanced) {
                return Ok(Ended::Preempted);
            }
        }
        nap(DEFAULT_POLL_INTERVAL, world, generation);
    }
}

/// Sleep out one poll interval in short naps, waking early when the world changes hands.
fn nap(interval: Duration, world: &World, generation: u64) {
    let mut slept = Duration::ZERO;
    while slept < interval && world.owns(generation) {
        thread::sleep(TAIL_NAP);
        slept += TAIL_NAP;
    }
}

/// Build the measurement one progress frame carries, from the scan's own coordinates.
fn mark(core: &TailCore, size: u64, events: i64, sink: &dyn EventSink) -> FoldMark {
    // The file may have GROWN under the scan — EverQuest is still writing it — so the denominator
    // is the larger of what it was and what has actually been read. `pct` then never exceeds 100
    // and never claims a byte nobody has seen.
    let total = size.max(core.read_offset());
    FoldMark {
        checkpoint: core.checkpoint_offset(),
        events,
        pct: pct_of(core.checkpoint_offset(), total),
        last_ts: sink.report().last_ts,
    }
}

/// `offset / total * 100`, as a float (owner ruling 17: `pct` is a float), clamped to [0, 100] and
/// answering 0 for a log with no bytes in it rather than a NaN.
fn pct_of(offset: u64, total: u64) -> f64 {
    if total == 0 {
        return 0.0;
    }
    #[allow(clippy::cast_precision_loss)]
    let pct = (offset as f64) / (total as f64) * 100.0;
    pct.clamp(0.0, 100.0)
}

/// The progress pacer. See the module header on which clock reads are allowed and why this one is.
struct Cadence {
    last: Instant,
}

impl Cadence {
    fn new() -> Self {
        // Set back a full interval so the FIRST boundary of a long fold announces immediately
        // rather than after a quarter second of silence.
        Self {
            last: Instant::now() - PROGRESS_EVERY,
        }
    }

    fn due(&mut self) -> bool {
        let now = Instant::now();
        if now.duration_since(self.last) < PROGRESS_EVERY {
            return false;
        }
        self.last = now;
        true
    }
}

#[cfg(test)]
mod tests {
    use super::{character_of, starter, ts_of, CountingSink, Event, EventSink, SinkReport};
    use crate::world::World;
    use protocol::generated::{EngineMessage, EpochReason, HealthResultStatus};
    use std::io::Write;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU32, AtomicUsize, Ordering};
    use std::sync::{Arc, Condvar, Mutex};
    use std::time::{Duration, Instant};

    #[test]
    fn the_character_comes_off_the_products_own_file_name() {
        assert_eq!(
            character_of(Path::new("C:/EQ/Logs/eqlog_Primitive_freeport.txt")).as_deref(),
            Some("Primitive")
        );
        // The oracle corpus's slice form goes through eqlog's own rule.
        assert_eq!(
            character_of(Path::new("eqlog_Primitive_freeport.patch-week.txt")).as_deref(),
            Some("Primitive")
        );
        // A character name may hold an underscore; the SERVER may not, so the last one splits.
        assert_eq!(
            character_of(Path::new("eqlog_Two_Names_freeport.txt")).as_deref(),
            Some("Two_Names")
        );
    }

    #[test]
    fn a_file_name_that_is_not_a_log_names_nobody() {
        for name in [
            "notalog.txt",
            "eqlog_freeport.txt",
            "eqlog__freeport.txt",
            "eqlog_Primitive_.txt",
            "eqlog_Primitive_freeport.log",
            "eqlog_Primitive_freeport",
            ".txt",
        ] {
            assert!(character_of(Path::new(name)).is_none(), "{name}");
        }
    }

    #[test]
    fn the_timestamp_is_read_back_out_of_the_serialized_event() {
        assert_eq!(
            ts_of(r#"{"kind":"unknown","seq":0,"ts":1787181707000,"raw":"[…]"}"#),
            Some(1_787_181_707_000)
        );
        // `group` is the one kind that writes a field AHEAD of the envelope.
        assert_eq!(
            ts_of(r#"{"kind":"group","change":"join","name":"Dranix","seq":3,"ts":17,"raw":"x"}"#),
            Some(17)
        );
        // A `raw` line that quotes the key cannot win: the envelope's copy comes first.
        assert_eq!(
            ts_of(r#"{"kind":"unknown","seq":0,"ts":5,"raw":"\"ts\":9999"}"#),
            Some(5)
        );
        assert_eq!(ts_of(r#"{"kind":"unknown"}"#), None);
    }

    #[test]
    fn the_counting_sink_counts_events_and_remembers_the_logs_own_clock() {
        let mut sink = CountingSink::default();
        for (seq, ts) in [(0, 100), (1, 200), (2, 300)] {
            sink.event(&Event {
                json: &format!(r#"{{"kind":"unknown","seq":{seq},"ts":{ts},"raw":"x"}}"#),
                seq,
                live: false,
            });
        }
        let report = sink.report();
        assert_eq!(report.events, 3);
        assert_eq!(report.last_ts, Some(300));
    }

    #[test]
    fn an_event_with_an_unreadable_stamp_still_counts() {
        let mut sink = CountingSink::default();
        sink.event(&Event {
            json: r#"{"kind":"unknown","seq":0,"ts":7,"raw":"x"}"#,
            seq: 0,
            live: false,
        });
        sink.event(&Event {
            json: r#"{"kind":"nonsense"}"#,
            seq: 1,
            live: false,
        });
        assert_eq!(sink.report().events, 2);
        assert_eq!(
            sink.report().last_ts,
            Some(7),
            "the last stamp that could be read stands; a missing one is not a zero"
        );
    }

    // ----------------------------------------------------------------------------------------
    // THE INGEST, OVER REAL BYTES.
    //
    // The corpus is committed (`tests/fixtures/*.log`, scrubbed), so these run in CI. Every claim
    // about WHAT was folded is settled against `eqlog::scan::scan_bytes` over the same bytes — the
    // proven path — rather than against a number typed here, which is the only way this suite can
    // still be right after a parser change.
    //
    // NOTHING HERE WAITS FOR THE CLOCK. `settle` waits for a condition and the deadline is a
    // FAILURE MECHANISM: it turns a deadlock into a red test instead of a run that never returns.
    // ----------------------------------------------------------------------------------------

    /// How long any condition in this suite may take before the test is called hung.
    const PATIENCE: Duration = Duration::from_secs(30);

    /// The fixture these tests fold. A loadout-swap window: 459 KB of dense mixed traffic —
    /// combat, casts, `/who`, zoning — which is what makes the event count worth comparing.
    const FIXTURE: &str = "cw2-loadout-swap-aug2.log";

    /// How many times the fixture is concatenated into the scratch log.
    ///
    /// A REAL LOG IS MEGABYTES AND A FIXTURE IS NOT. The properties under test here only exist
    /// across READ BOUNDARIES — a fold long enough to be preempted in the middle of, more than one
    /// progress cadence, a scan that spans several 1 MiB slices — so the scratch copy is built big
    /// enough to have them. Repetition is sound because the parser holds no state across lines: the
    /// oracle folds THE SAME BYTES, so the two agree whatever the repetition does.
    const REPEATS: usize = 6;

    fn repo_root() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .ancestors()
            .nth(3)
            .expect("the crate is three levels below the repo root")
            .to_path_buf()
    }

    /// A scratch directory holding one log named the way the product names one, so the character
    /// comes off the file name exactly as it does in the field.
    struct Scratch(PathBuf);

    impl Scratch {
        fn new(tag: &str) -> Self {
            static N: AtomicU32 = AtomicU32::new(0);
            let dir = std::env::temp_dir().join(format!(
                "engined-ingest-{}-{}-{tag}",
                std::process::id(),
                N.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir_all(&dir).expect("a scratch dir");
            Self(dir)
        }

        fn log(&self) -> PathBuf {
            self.0.join("eqlog_Primitive_freeport.txt")
        }

        /// Write the fixture into the scratch log, `REPEATS` times over.
        fn stage(&self) -> PathBuf {
            let source = repo_root().join("tests").join("fixtures").join(FIXTURE);
            let bytes = std::fs::read(&source)
                .unwrap_or_else(|e| panic!("the fixture at {} is readable: {e}", source.display()));
            let path = self.log();
            let mut out = std::fs::File::create(&path).expect("the scratch log");
            for _ in 0..REPEATS {
                out.write_all(&bytes).expect("the scratch log takes bytes");
            }
            out.flush().expect("flush");
            path
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ignored = std::fs::remove_dir_all(&self.0);
        }
    }

    /// Append one line the way EverQuest appends one: an open, a write, a flush.
    fn append(path: &Path, line: &str) {
        let mut file = std::fs::OpenOptions::new()
            .append(true)
            .open(path)
            .expect("the log takes an append");
        file.write_all(line.as_bytes()).expect("append");
        file.flush().expect("flush");
    }

    /// THE ORACLE: what the proven scan finds in these exact bytes.
    fn scan_oracle(path: &Path) -> i64 {
        let bytes = std::fs::read(path).expect("the log is readable");
        let character = character_of(path).expect("the scratch log names a character");
        let parser = eqlog::parser_for(&character, eqlog::host_timezone());
        i64::try_from(eqlog::scan::scan_bytes(&parser, &bytes, |_line| {})).expect("a count")
    }

    /// Wait for a condition, failing with `what` if it never holds.
    ///
    /// IT SLEEPS BETWEEN LOOKS RATHER THAN SPINNING. A spin here is not a faster test, it is a test
    /// that takes a core away from the fold it is waiting for — measured: a spinning `settle` under
    /// the suite's own parallelism starved the tail thread past a thirty-second deadline.
    fn settle(what: &str, mut ready: impl FnMut() -> bool) {
        const LOOK_EVERY: Duration = Duration::from_millis(2);
        let deadline = Instant::now() + PATIENCE;
        while !ready() {
            assert!(Instant::now() < deadline, "timed out waiting for {what}");
            std::thread::sleep(LOOK_EVERY);
        }
    }

    /// One event, as a test sink saw it.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    struct Taken {
        sink: usize,
        seq: i64,
        live: bool,
    }

    /// What every sink this factory builds writes into. ONE SHARED LIST, in the order events were
    /// taken, so an interleaving would be visible rather than inferred.
    #[derive(Default)]
    struct Ledger {
        taken: Mutex<Vec<Taken>>,
        built: AtomicUsize,
    }

    impl Ledger {
        fn taken(&self) -> Vec<Taken> {
            self.taken
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .clone()
        }

        fn of(&self, sink: usize) -> Vec<Taken> {
            self.taken()
                .into_iter()
                .filter(|t| t.sink == sink)
                .collect()
        }
    }

    /// A gate a sink stops at, until a test opens it. THE DETERMINISM TRICK of this suite: a fold
    /// held at its first event is a fold a test can ask questions about without racing it.
    #[derive(Default)]
    struct Gate {
        open: Mutex<bool>,
        changed: Condvar,
    }

    impl Gate {
        fn wait(&self) {
            let mut open = self
                .open
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            while !*open {
                open = self
                    .changed
                    .wait(open)
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
            }
        }

        fn release(&self) {
            *self
                .open
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner) = true;
            self.changed.notify_all();
        }
    }

    /// A sink that records what it was handed, and optionally stops at a gate on its first event.
    struct RecordingSink {
        id: usize,
        ledger: Arc<Ledger>,
        gate: Option<Arc<Gate>>,
        report: SinkReport,
    }

    impl EventSink for RecordingSink {
        fn event(&mut self, event: &Event<'_>) {
            self.report.events += 1;
            if event.live {
                self.report.live_events += 1;
            }
            self.report.last_seq = Some(event.seq);
            self.report.last_ts = ts_of(event.json);
            self.ledger
                .taken
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .push(Taken {
                    sink: self.id,
                    seq: event.seq,
                    live: event.live,
                });
            // THE GATE IS TAKEN AFTER THE RECORD, so a test can see that the fold reached its first
            // event and is now standing still — which is the whole point of holding it.
            if let Some(gate) = self.gate.take() {
                gate.wait();
            }
        }

        fn report(&self) -> SinkReport {
            self.report
        }
    }

    /// A world whose attaches fold into recording sinks. The gate, when given, is handed to the
    /// FIRST sink only — the one whose fold a preemption test needs to hold still.
    fn recording_world(ledger: &Arc<Ledger>, gate: Option<Arc<Gate>>) -> World {
        let ledger = Arc::clone(ledger);
        World::with_ingest(starter(Arc::new(move || {
            let id = ledger.built.fetch_add(1, Ordering::SeqCst);
            Box::new(RecordingSink {
                id,
                ledger: Arc::clone(&ledger),
                gate: if id == 0 { gate.clone() } else { None },
                report: SinkReport::default(),
            })
        })))
    }

    /// Every seq a sink was handed, in order, starting at 0 and skipping nothing.
    fn is_one_unbroken_fold(taken: &[Taken]) -> bool {
        taken
            .iter()
            .enumerate()
            .all(|(i, t)| t.seq == i64::try_from(i).expect("a seq"))
    }

    #[test]
    fn an_attach_folds_the_whole_log_and_the_count_is_the_scans_own() {
        let scratch = Scratch::new("whole");
        let log = scratch.stage();
        let expected = scan_oracle(&log);
        let ledger = Arc::new(Ledger::default());
        let world = recording_world(&ledger, None);

        world.attach(&log.to_string_lossy());
        settle("the fold to land", || {
            matches!(world.health().status, HealthResultStatus::Live)
        });

        let mark = world.mark();
        assert_eq!(
            mark.events, expected,
            "the ingest folds what the scan finds"
        );
        assert_eq!(
            mark.checkpoint,
            std::fs::metadata(&log).expect("the log").len(),
            "the fixture ends on a newline, so THE MARK reaches the last byte"
        );
        assert_eq!(mark.log.as_deref(), Some(log.as_path()));
        assert!(
            mark.last_ts.is_some(),
            "the log's own clock, not the host's"
        );

        let taken = ledger.of(0);
        assert_eq!(i64::try_from(taken.len()).expect("a count"), expected);
        assert!(is_one_unbroken_fold(&taken));
        assert!(
            taken.iter().all(|t| !t.live),
            "everything the scan folds is history"
        );
    }

    #[test]
    fn a_second_attach_preempts_the_first_and_no_events_interleave() {
        let scratch = Scratch::new("preempt");
        let log = scratch.stage();
        let expected = scan_oracle(&log);
        let ledger = Arc::new(Ledger::default());
        let gate = Arc::new(Gate::default());
        let world = recording_world(&ledger, Some(Arc::clone(&gate)));
        let listener = world.join();
        world.open_subscription(listener.id, 7);

        // The first fold reaches its first event and stops there, holding the world.
        let first = world.attach(&log.to_string_lossy());
        assert_eq!(*first.epoch, 2);
        settle("the first fold to reach its first event", || {
            !ledger.of(0).is_empty()
        });

        // THE PREEMPTION. Last pick wins, and the pick that lost is still standing at the gate.
        let second = world.attach(&log.to_string_lossy());
        assert_eq!(*second.epoch, 3, "the generation strictly increases");
        assert!(second.accepted);
        gate.release();

        settle("the winning fold to land", || {
            matches!(world.health().status, HealthResultStatus::Live)
                && world.mark().events == expected
        });

        let loser = ledger.of(0);
        let winner = ledger.of(1);
        assert!(
            !loser.is_empty() && i64::try_from(loser.len()).expect("a count") < expected,
            "the loser abandoned its fold: {} of {expected} events",
            loser.len()
        );
        assert!(
            is_one_unbroken_fold(&loser),
            "the loser's own stream is contiguous — no other fold reached its sink"
        );
        assert!(
            is_one_unbroken_fold(&winner),
            "the winner's own stream is contiguous — the loser's events reached no sink but its own"
        );
        assert_eq!(i64::try_from(winner.len()).expect("a count"), expected);

        // EXACTLY ONE FOLD-LANDS PER WINNING ATTACH: two bumps were announced, one reset arrived,
        // and it names the generation that landed.
        let mut bumps = Vec::new();
        let mut resets = Vec::new();
        while let Ok(message) = listener.inbox.try_recv() {
            match message {
                EngineMessage::EpochMessage(epoch)
                    if matches!(epoch.reason, EpochReason::Attach) =>
                {
                    bumps.push(*epoch.epoch);
                }
                EngineMessage::ResetMessage(reset) => resets.push((*reset.id, *reset.epoch)),
                _ => {}
            }
        }
        assert_eq!(bumps, vec![2, 3]);
        assert_eq!(resets, vec![(7, 3)], "one reset, naming the winner");
    }

    #[test]
    fn the_health_states_walk_starting_attaching_folding_live() {
        let scratch = Scratch::new("walk");
        let log = scratch.stage();
        let ledger = Arc::new(Ledger::default());
        let gate = Arc::new(Gate::default());

        // The walk's first step is observed from INSIDE the attach, before the ingest thread can
        // possibly have run: the starter is called after the epoch's critical section and before
        // anything else exists.
        let observed_starting = Arc::new(Mutex::new(false));
        let seen = Arc::clone(&observed_starting);
        let held = Arc::clone(&gate);
        let world = World::with_ingest(Arc::new(move |world, generation, path| {
            *seen
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner) =
                matches!(world.health().status, HealthResultStatus::Starting);
            let sink = RecordingSink {
                id: 0,
                ledger: Arc::clone(&ledger),
                gate: Some(Arc::clone(&held)),
                report: SinkReport::default(),
            };
            super::start(world, generation, path, Box::new(sink));
        }));

        world.attach(&log.to_string_lossy());
        assert!(
            *observed_starting
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner),
            "an accepted attach is `starting` before its ingest exists"
        );

        // ATTACHING is the window in which the log is opened and the parse's inputs are built. It is
        // WIDE — the spell DB is the whole committed corpus and takes seconds to build in a debug
        // build (the ingest prints its own measurement) — so a sampler looking every couple of
        // milliseconds cannot miss it.
        settle("the ingest to report `attaching`", || {
            matches!(world.health().status, HealthResultStatus::Attaching)
        });
        // FOLDING is deterministic: the sink is holding the first event at the gate, so the scan
        // cannot finish until this test lets it.
        settle("the scan to start", || {
            matches!(world.health().status, HealthResultStatus::Folding)
        });
        gate.release();
        settle("the tail to take over", || {
            matches!(world.health().status, HealthResultStatus::Live)
        });
    }

    #[test]
    fn a_line_appended_after_the_fold_lands_arrives_live_through_the_same_sink() {
        let scratch = Scratch::new("append");
        let log = scratch.stage();
        let scanned = scan_oracle(&log);
        let ledger = Arc::new(Ledger::default());
        let world = recording_world(&ledger, None);

        world.attach(&log.to_string_lossy());
        settle("the fold to land", || {
            matches!(world.health().status, HealthResultStatus::Live)
        });
        let mark_before = world.mark().checkpoint;

        // THE GAME WRITES A LINE. Two of them: one the parser types, one it files as `unknown` —
        // both are events, and the tail is a byte-level reader that has no opinion about either.
        let appended = "[Wed Aug 19 16:21:54 2026] You gain experience! (3.288%)\n\
                        [Wed Aug 19 16:21:55 2026] You are not currently assigned to an adventure.\n";
        append(&log, appended);

        settle("the appended lines to arrive", || {
            world.mark().events == scanned + 2
        });
        let mark_after = world.mark().checkpoint;
        assert_eq!(
            mark_after - mark_before,
            u64::try_from(appended.len()).expect("a length"),
            "THE MARK advanced by exactly the bytes the game wrote"
        );

        let taken = ledger.of(0);
        assert!(
            is_one_unbroken_fold(&taken),
            "the seq continues across the seam"
        );
        let live: Vec<i64> = taken.iter().filter(|t| t.live).map(|t| t.seq).collect();
        assert_eq!(
            live,
            vec![scanned, scanned + 1],
            "the two live events follow the scan's last seq, through the same sink"
        );
    }

    #[test]
    fn a_half_written_line_is_not_an_event_until_the_game_finishes_it() {
        let scratch = Scratch::new("partial");
        let log = scratch.stage();
        let scanned = scan_oracle(&log);
        let ledger = Arc::new(Ledger::default());
        let world = recording_world(&ledger, None);

        world.attach(&log.to_string_lossy());
        settle("the fold to land", || {
            matches!(world.health().status, HealthResultStatus::Live)
        });
        let mark_before = world.mark().checkpoint;

        append(&log, "[Wed Aug 19 16:21:54 2026] You gain exp");
        // Nothing to settle ON — this is an ABSENCE. Two poll intervals of the tail is what makes
        // the claim mean something, and it is the one place in this suite that waits on a clock.
        std::thread::sleep(super::DEFAULT_POLL_INTERVAL * 3);
        assert_eq!(world.mark().events, scanned, "half a line is not a line");
        assert_eq!(
            world.mark().checkpoint,
            mark_before,
            "and THE MARK waits with it"
        );

        append(&log, "erience! (3.288%)\n");
        settle("the finished line to arrive", || {
            world.mark().events == scanned + 1
        });
    }

    #[test]
    fn an_attach_the_engine_cannot_open_leaves_the_world_idle_with_its_epoch_intact() {
        let scratch = Scratch::new("missing");
        let missing = scratch.0.join("eqlog_Nobody_freeport.txt");
        let ledger = Arc::new(Ledger::default());
        let world = recording_world(&ledger, None);

        let result = world.attach(&missing.to_string_lossy());
        assert!(
            result.accepted,
            "an attach is accepted at the moment it wins, not when the file proves readable"
        );
        settle("the ingest to give up", || {
            matches!(world.health().status, HealthResultStatus::Idle)
        });
        assert_eq!(
            *world.health().epoch,
            2,
            "a fold that could not start bumps nothing back"
        );
        assert!(ledger.taken().is_empty());
    }
}
