// THE GRID AND THE POSTERIOR — how one cell's R and its interval are actually computed (JOS-387,
// split out of resistModel.ts).
//
// Pure. `resistModel.ts` turns rows into likelihood TERMS and this file turns terms into a number
// with an interval; the split is along that seam because the two change for different reasons — the
// terms move when the log or the spell table does, and this file moves when the statistics do.
//
// ── WHY THE POSTERIOR MEDIAN AND NOT THE MAXIMUM (owner review, 2026-08-16) ─────────────────────
//
// The first cut reported the ARGMAX of the shrunk posterior and an interval from the profile
// likelihood. It is right wherever the likelihood has a peak and WRONG wherever it has a PLATEAU,
// which is the shape the game's own formula produces constantly:
//
//   * `P(resist) = rc/200` SATURATES. Once rc reaches 200 every all-or-nothing cast is resisted, so
//     every R above that point predicts the same thing and the likelihood is flat from there to the
//     top of the grid. A cell where the mob resisted EVERYTHING therefore has a plateau, the argmax
//     sits at its LOWEST edge (the first grid point that explains the data), and the row reports the
//     weakest resistance consistent with the evidence as though it were the estimate. MEASURED: a
//     dracoliche's disease read `R 60 (46-600) resistant` off thirty observations that were all
//     resists — the honest reading of which is "somewhere in the hundreds, and nothing you cast on
//     that axis landed".
//   * The mirror case at the bottom (rc <= 0, nothing ever resisted) has the same shape upside down.
//
// The MEDIAN of the posterior lands mid-plateau, which is the middle of what the evidence allows,
// and on a peaked likelihood it sits within a grid step of the old maximum. So the change is
// invisible where the old answer was right and it is the whole fix where it was not.
//
// THE INTERVAL IS NOW THE CENTRAL 95% OF THE SAME POSTERIOR rather than a profile-likelihood cut.
// One distribution produces both numbers, so the point can no longer fall outside its own interval
// (the old code had to clamp it back in), and the two are read against each other honestly.
//
// ── AND SOMETIMES THE MODEL SIMPLY DOES NOT FIT ────────────────────────────────────────────────
//
// `fitPinned` is the guard the same review asked for. A posterior whose median has slid to the
// floor or the ceiling of the grid is not an estimate — it is the fitter saying "no R in the range
// this game can express explains what you showed me". MEASURED: Bzzazzt (a charmed level-50 spider)
// throwing Deadly Poison at the level-70 Eye of Veeshan is resisted 52% of the time, and at that
// level gap `levelMod` alone is +200 — so every R at or above zero predicts 100% resisted, the
// fitter slides to the bottom of the grid looking for the negative R that would explain a 52% rate,
// and the display clamped that to `R 0 … weak`. A creature that resists half of everything thrown at
// it was being reported as WEAK. The honest output is not a number; it is the resist rate and a
// sentence saying the model could not fit it.

/** Grid search bounds and step for R. Step 2 is the resolution every printed interval carries. */
export const R_MIN = -150
export const R_MAX = 600
export const R_STEP = 2

/** The central credible interval the surfaces print. */
export const CREDIBLE_MASS = 0.95

/** One cell's answer: the posterior median, its central interval, and whether it may be believed. */
export interface GridFit {
  R: number
  lo: number
  hi: number
  /**
   * THE POSTERIOR RAN OUT OF GRID. The median is within one step of an edge, or the interval
   * collapsed to nothing at one. Callers must not print a number or a tag — see `fitPinned`.
   */
  pinned: boolean
}

/** Log density of the posterior at each grid point, in grid order. */
export function posteriorLogs(logDensity: (R: number) => number): { Rs: number[]; logs: number[] } {
  const Rs: number[] = []
  const logs: number[] = []
  for (let R = R_MIN; R <= R_MAX; R += R_STEP) {
    Rs.push(R)
    logs.push(logDensity(R))
  }
  return { Rs, logs }
}

/**
 * The median and the central 95% of a posterior given as log densities on the grid.
 *
 * Normalised by the maximum before exponentiating, which is the standard trick and the only reason
 * a cell with six hundred observations does not underflow to a vector of zeros.
 */
export function gridFit(logDensity: (R: number) => number): GridFit {
  const { Rs, logs } = posteriorLogs(logDensity)
  let max = -Infinity
  for (const l of logs) if (l > max) max = l
  const weights = logs.map((l) => Math.exp(l - max))
  let total = 0
  for (const w of weights) total += w
  if (!(total > 0) || !Number.isFinite(total)) {
    // Cannot happen with a floored likelihood; answering the middle of the grid beats answering NaN.
    return { R: 0, lo: R_MIN, hi: R_MAX, pinned: true }
  }
  const at = (q: number): number => {
    let acc = 0
    for (let i = 0; i < Rs.length; i++) {
      acc += weights[i]
      if (acc / total >= q) return Rs[i]
    }
    return Rs[Rs.length - 1]
  }
  const tail = (1 - CREDIBLE_MASS) / 2
  const R = at(0.5)
  const lo = at(tail)
  const hi = at(1 - tail)
  return { R, lo, hi, pinned: fitPinned(R, lo, hi) }
}

/**
 * Has the posterior slid off the end of the grid? See the header for the measured case.
 *
 * A ZERO-WIDTH INTERVAL COUNTS ONLY AT AN EDGE. In the middle of the grid a collapsed interval is a
 * cell so well determined that 95% of the posterior sits on one grid point, which is a fine answer
 * and not a failure; at an edge it is the fitter pinned against the wall with nowhere to spread.
 */
export function fitPinned(R: number, lo: number, hi: number): boolean {
  const atFloor = R <= R_MIN + R_STEP
  const atCeiling = R >= R_MAX - R_STEP
  if (atFloor || atCeiling) return true
  return hi === lo && (lo <= R_MIN + R_STEP || hi >= R_MAX - R_STEP)
}
