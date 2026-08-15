// eqWindowMode.ts — ONE READER FOR `eqclient.ini`, AND THE ADVISORY THAT HANGS OFF IT (JOS-368).
//
// WHY THIS FILE EXISTS AT ALL. The window-mode reading was built for the setup snapshot (JOS-364)
// and lived private inside `telemetry/setupSnapshot.ts`. A second consumer arrived one ticket
// later — Preferences, which wants to tell an exclusive-fullscreen player that overlays draw best
// in windowed mode — and the wrong answer to that is a second parse of somebody else's settings
// file. So the reader moved HERE, the snapshot imports it, and there is one place that knows where
// `eqclient.ini` is and what one key in it means.
//
// THE PARSE ITSELF IS NOT HERE. `eqWindowModeOf` (telemetry/setupFacts.ts) is pure, unit-tested,
// and reads exactly one key; this file is the I/O and the store around it. That split is the same
// one setupSnapshot/setupFacts already draws, and keeping it means the Preferences path and the
// telemetry path cannot come to different conclusions about the same file.
//
// NOTHING HERE THROWS. An `eqclient.ini` an antivirus has locked, a machine with no EverQuest
// install, a store that refuses — each answers `unknown`, and `unknown` shows no note. An advisory
// that could break the settings pane would be worse than the hitch it is warning about.
//
// AND IT IS READ FRESH, NOT CACHED. The file changes when the player changes their video settings
// in game, which is precisely the action this note is asking them to take — a cached answer would
// keep advising them to do the thing they just did. It is one small file read per open of the
// Preferences pane.

import { app } from 'electron'
import { readFileSync } from 'fs'
import { join } from 'path'
import { effectiveEqRoot } from './log/config'
import { getOverlayConfig, settingsStore } from './store'
import { OVERLAY_KINDS } from '../shared/types'
import { eqWindowModeOf } from './telemetry/setupFacts'
import type { EqWindowNotice } from '../shared/eqWindowMode'
import type { TelemetryEqWindowMode } from '../shared/telemetry'

/**
 * EverQuest's own `eqclient.ini`, read whole, or `null` when there is nothing to read.
 *
 * The path comes from the install-dir discovery this app already owns (`effectiveEqRoot`) —
 * override, then auto-discovery, then the canonical default — so nothing new is searched for and a
 * machine with no install simply reads a file that is not there.
 *
 * THROWS on a locked or unreadable file, deliberately: both callers already have a defence
 * (`safely` in the snapshot, the try in `eqWindowMode` below) and a reader that swallowed its own
 * failures would make "no install" and "cannot read" the same answer at the wrong layer.
 */
export function readEqClientIni(): string | null {
  const root = effectiveEqRoot()
  if (root === '') return null
  return readFileSync(join(root, 'eqclient.ini'), 'utf8')
}

/** The game's display mode as this machine has it set, or 'unknown' if anything at all went wrong. */
export function eqWindowMode(): TelemetryEqWindowMode {
  try {
    return eqWindowModeOf(readEqClientIni())
  } catch {
    return 'unknown'
  }
}

/**
 * Should Preferences be saying something, and what is the mode it would be saying it about?
 *
 * THREE CONDITIONS, ALL REQUIRED, and each one is a way of not talking to someone who does not
 * need this:
 *   * the mode really is EXCLUSIVE — 'unknown' is a file we could not read, never a guess;
 *   * this install has AT LEAST ONE OVERLAY OPEN — the note is about a collision, and a player
 *     with no overlays open is not in one, however their game is configured;
 *   * it has not already been dismissed AT THIS VERSION — see storeShape.ts for why the memory is
 *     a version rather than a boolean.
 */
export function getEqWindowNotice(): EqWindowNotice {
  const mode = eqWindowMode()
  if (mode !== 'exclusive' || !anyOverlayOpen()) return { mode, show: false }
  return { mode, show: dismissedVersion() !== app.getVersion() }
}

/**
 * "I have read it." Remembers THIS version and answers with the state the card should now be in,
 * so the pane renders what was actually stored rather than assuming its request landed.
 */
export function dismissEqWindowNotice(): EqWindowNotice {
  settingsStore.set('eqExclusiveNoticeDismissedVersion', app.getVersion())
  return getEqWindowNotice()
}

/** Any floating overlay open on this install. The cursor ring is deliberately not counted: it is a
 *  transparent circle, not a panel, and it is not what this note is about. */
function anyOverlayOpen(): boolean {
  return OVERLAY_KINDS.some((kind) => getOverlayConfig(kind).open)
}

/** The stored version, defended against a hand-edited store holding something that is not a string. */
function dismissedVersion(): string | undefined {
  const raw: unknown = settingsStore.get('eqExclusiveNoticeDismissedVersion')
  return typeof raw === 'string' ? raw : undefined
}
