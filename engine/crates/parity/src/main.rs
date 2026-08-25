//! ============================================================================
//! parity — the Rust parser's event stream, as NDJSON, for one log file (JOS-469).
//! ============================================================================
//!
//!     parity <logfile>                     write the stream to stdout
//!     parity <logfile> --golden <path>     diff it internally, report the FIRST divergence
//!     parity <logfile> --tz <IANA zone>    resolve local time through that zone (default: host)
//!
//! TWO MODES, and the second one exists because the first cannot be piped for 100 MB of NDJSON
//! without the pipe becoming the measurement. `--golden` reads the recorded stream through a fixed
//! buffer, compares line by line, and prints the first place the two stopped agreeing plus both
//! counts — the same shape `tests/bench/goldenCli.mts` prints for the TS re-fold.
//!
//! IT NEVER PRINTS MORE THAN ONE PAIR OF LINES. The slices are the owner's real game log and they
//! never leave his machine; a diff report is a diagnostic, not an export.

use std::fs::File;
use std::io::{BufRead, BufReader, BufWriter, Read, Write};
use std::process::ExitCode;

struct Args {
    log: String,
    golden: Option<String>,
    tz: Option<String>,
}

fn parse_args() -> Result<Args, String> {
    let mut log: Option<String> = None;
    let mut golden: Option<String> = None;
    let mut tz: Option<String> = None;
    let mut it = std::env::args().skip(1);
    while let Some(a) = it.next() {
        match a.as_str() {
            "--golden" => golden = Some(it.next().ok_or("--golden needs a path")?),
            "--tz" => tz = Some(it.next().ok_or("--tz needs an IANA zone name")?),
            other if other.starts_with("--") => return Err(format!("unknown flag {other}")),
            other => log = Some(other.to_string()),
        }
    }
    Ok(Args {
        log: log.ok_or("usage: parity <logfile> [--golden <path>] [--tz <zone>]")?,
        golden,
        tz,
    })
}

fn main() -> ExitCode {
    let args = match parse_args() {
        Ok(a) => a,
        Err(e) => {
            eprintln!("parity: {e}");
            return ExitCode::from(2);
        }
    };
    let tz = match &args.tz {
        Some(name) => match name.parse::<eqlog::Tz>() {
            Ok(tz) => tz,
            Err(_) => {
                eprintln!("parity: {name} is not an IANA zone name");
                return ExitCode::from(2);
            }
        },
        None => eqlog::host_timezone(),
    };
    let file_name = std::path::Path::new(&args.log)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let Some(character) = eqlog::character_of(&file_name) else {
        eprintln!("parity: cannot read a character out of \"{file_name}\"");
        return ExitCode::from(2);
    };

    let mut bytes = Vec::new();
    if let Err(e) = File::open(&args.log).and_then(|mut f| f.read_to_end(&mut bytes)) {
        eprintln!("parity: cannot read {}: {e}", args.log);
        return ExitCode::from(2);
    }

    let parser = eqlog::parser_for(&character, tz);
    match args.golden {
        None => {
            let stdout = std::io::stdout();
            let mut out = BufWriter::with_capacity(1 << 20, stdout.lock());
            let n = eqlog::scan::scan_bytes(&parser, &bytes, |line| {
                let _ = out.write_all(line.as_bytes());
                let _ = out.write_all(b"\n");
            });
            let _ = out.flush();
            eprintln!("parity: {n} events, tz={tz}, character={character}");
            ExitCode::SUCCESS
        }
        Some(golden) => diff(&parser, &bytes, &golden, &character, tz),
    }
}

/// Compare against the recorded stream, latching the FIRST divergence and folding on so the counts
/// are still reported — `checkSlice`'s rule: "the stream diverged at event 412,003 AND …" is a
/// different diagnosis from "the stream diverged and nothing else did".
fn diff(
    parser: &eqlog::Parser,
    bytes: &[u8],
    golden: &str,
    character: &str,
    tz: eqlog::Tz,
) -> ExitCode {
    let f = match File::open(golden) {
        Ok(f) => f,
        Err(e) => {
            eprintln!("parity: cannot read {golden}: {e}");
            return ExitCode::from(2);
        }
    };
    let mut reader = BufReader::with_capacity(1 << 20, f);
    let mut want = String::new();
    let mut first: Option<(u64, String, String)> = None;
    let mut at: u64 = 0;
    let started = std::time::Instant::now();
    let n = eqlog::scan::scan_bytes(parser, bytes, |got| {
        if first.is_some() {
            return;
        }
        at += 1;
        want.clear();
        let read = reader.read_line(&mut want).unwrap_or(0);
        let expected = if read == 0 {
            "(golden ended)".to_string()
        } else {
            want.trim_end_matches('\n')
                .trim_end_matches('\r')
                .to_string()
        };
        if expected != got {
            first = Some((at, expected, got.to_string()));
        }
    });
    let ms = started.elapsed().as_millis();
    let stamps = parser.unparsed_stamps.get();
    if stamps > 0 {
        println!("  note   : {stamps} timestamped lines whose stamp the pattern declined");
    }
    match first {
        None => {
            // A golden with MORE lines than the re-fold produced is a divergence too.
            want.clear();
            if reader.read_line(&mut want).unwrap_or(0) > 0 {
                println!("DIVERGED at event {} (the golden has more)", n + 1);
                println!("  golden : {}", want.trim_end());
                println!("  rust   : (re-fold ended)");
                return ExitCode::FAILURE;
            }
            println!("OK {n} events in {ms} ms (character={character}, tz={tz})");
            ExitCode::SUCCESS
        }
        Some((at, expected, got)) => {
            println!("DIVERGED at event {at} (character={character}, tz={tz}); {n} events folded in {ms} ms");
            println!("  golden : {expected}");
            println!("  rust   : {got}");
            ExitCode::FAILURE
        }
    }
}
