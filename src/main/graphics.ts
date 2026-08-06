// graphics.ts — GRAPHICS SAFE MODE, decided at the only moment Electron will accept it (JOS-40).
//
// `app.disableHardwareAcceleration()` is a BEFORE-READY call: Electron reads it while assembling
// the GPU process and ignores it afterwards. So this module is invoked from the composition
// root's module scope — earlier than `whenReady`, earlier than the first window, and (by the
// import order index.ts documents) after channel.ts has chosen `userData` and store.ts has
// migrated and opened the settings file. That ordering is the whole reason a persisted switch can
// decide a flag that must be set before the app exists.
//
// TWO WAYS IN, ONE MECHANISM:
//
//   EQ_DISABLE_GPU=1  — one launch, no UI required. This is the door for the user whose window is
//                       black: they cannot open Preferences in an app they cannot see, and a
//                       support reply ("start it once with this set") has to work on the first
//                       try. It NEVER writes the setting — a diagnostic must not silently become
//                       a configuration.
//   the stored switch — Preferences → Graphics, from the next launch onward.
//
// NOTHING HERE KNOWS WHAT A WINE PREFIX IS, and JOS-31 must not teach it: the env var is the
// generic door, and a platform that needs software rendering sets it exactly like everyone else.
//
// FAILING TO READ THE SETTING IS NOT A REASON NOT TO BOOT. Every path is wrapped: a store that
// throws leaves the app on hardware acceleration (the default everyone else gets) with a line in
// errors.log, never a process that died deciding how to draw.

import { app } from 'electron'
import { logError, logInfo } from './errorLog'
import { getGraphicsPrefs } from './store'
import { GPU_ENV_VAR, envDisablesGpu } from '../shared/graphicsPrefs'

/** Why safe mode is on for this launch — or null when it is not on. */
export type SafeModeSource = 'env' | 'setting'

/**
 * Decide, from an environment and the stored switch, whether this launch draws in software.
 *
 * The ENV WINS and is checked first, because it is the override of last resort: a user who has
 * been told to set it is a user for whom the stored value is either wrong or unreachable.
 */
export function safeModeSource(env: NodeJS.ProcessEnv = process.env): SafeModeSource | null {
  if (envDisablesGpu(env)) return 'env'
  try {
    return getGraphicsPrefs().safeMode ? 'setting' : null
  } catch (err) {
    logError('main:graphics', err)
    return null
  }
}

/** Whether this process actually disabled hardware acceleration. Read by nothing but the log
 *  line below today; exported so a future diagnostic can state the launch's real mode rather
 *  than re-deriving it from a setting that may have been changed since. */
let safeModeActive: SafeModeSource | null = null

export function activeSafeMode(): SafeModeSource | null {
  return safeModeActive
}

/**
 * Apply graphics safe mode if this launch asked for it. Call ONCE, from module scope in the
 * composition root — after `ready` it is a no-op that Electron silently ignores, which is the
 * failure mode this file's placement exists to prevent.
 */
export function applyGraphicsSafeMode(): void {
  const source = safeModeSource()
  if (!source) return
  try {
    app.disableHardwareAcceleration()
    safeModeActive = source
    logInfo(
      `[everquest-companion] Graphics safe mode is ON for this launch (${
        source === 'env' ? `${GPU_ENV_VAR} is set` : 'Preferences → Graphics'
      }): drawing without hardware acceleration.`
    )
  } catch (err) {
    logError('main:graphics', err)
  }
}
