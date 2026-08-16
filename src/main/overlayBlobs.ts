// overlayBlobs.ts — the PER-KIND blobs inside an OverlayConfig, normalized in one place.
//
// Two overlay kinds carry knobs nobody else has: the celebration toast's timing (`toast`) and an
// alert text lane's own font/size/colour/seconds (`alertText`). Both ride `overlays.<kind>` rather
// than a second store key, so a kind is still ONE persisted record with one open-state and one
// bounds — and both are renderer-writable from a Preferences panel, so both are clamped by their
// own normalizer rather than trusted.
//
// PRESENT ON THE KIND THAT OWNS IT, DELETED EVERYWHERE ELSE. That second half is the part worth
// having in one function: a merge-patch arrives from a renderer, and a meter must not be able to
// grow a toast blob (or a lane's defaults) out of a malformed one. Doing it on the way IN and on
// the way OUT means a hand-edited store file cannot smuggle one in either.
//
// ITS OWN MODULE because store.ts sits at the measured 400-code-line ceiling — the same reason
// uiScale.ts is its own module (see the banner in store.ts). Pure apart from the normalizers it
// calls, so it needs no Electron and nothing here reads the store.

import { DEFAULT_TOAST_CONFIG, normalizeToastConfig } from '../shared/toast'
import { normalizeAlertTextDefaults } from '../shared/alertDisplay'
import { isAlertOverlayKind } from '../shared/alertOverlays'
import type { OverlayConfig, OverlayKind } from '../shared/types'

/** Fill this kind's own blob and drop the ones it does not own. Mutates in place. */
export function normalizeKindBlobs(kind: OverlayKind, cfg: OverlayConfig): void {
  if (kind === 'toast') cfg.toast = normalizeToastConfig({ ...DEFAULT_TOAST_CONFIG, ...cfg.toast })
  else delete cfg.toast
  if (isAlertOverlayKind(kind)) cfg.alertText = normalizeAlertTextDefaults(cfg.alertText)
  else delete cfg.alertText
}
