// Shared vocabulary for the parse cascade (see parser.ts).
//
// The single parse pass is a CASCADE of per-family classifiers whose ORDER IS SEMANTIC
// (e.g. the resist family must test the possessive-YOUR form before the named-caster form
// because 712 spell names contain `'s`). Each classifier is a pure
// `(ClassifyCtx) => LogEvent | null`; parser.ts holds the one ordered list and runs it.
// This module carries the pieces every family needs: the context envelope and the
// name-normalization helpers (moved here verbatim from combat/parse.ts by way of parser.ts).

import type { LogEvent } from '../../shared/logEvents'
import type { ParserConfig } from './rulesets'

// THE VOCABULARY MOVED OUT (JOS-499 item 2). `idKey`, `spellCanonKey` and `spellRank` were written
// here and are not ABOUT parsing — they are how a name folds into a join key — and this file is
// deleted with the fold while thirteen surviving consumers still need them. They now live in
// `shared/spellKey.ts` and are re-exported here so the doomed files below need no edit and the tree
// stays buildable across the prep commits. This line dies with the file.
export { idKey, spellCanonKey, spellRank } from '../../shared/spellKey'

/**
 * One log line, pre-split, plus the profile's parser config — the argument every
 * classifier takes. `text` is the message with the `[timestamp] ` prefix removed.
 */
export interface ClassifyCtx {
  readonly text: string
  readonly ts: number
  readonly seq: number
  readonly raw: string
  readonly cfg: ParserConfig
}

/** A single line-family matcher: returns its event, or null to let the cascade continue. */
export type Classifier = (c: ClassifyCtx) => LogEvent | null

export function norm(name: string): string {
  const n = name.trim()
  const l = n.toLowerCase()
  if (l === 'you' || l === 'yourself' || l === 'your') return 'You'
  return n
}


export function cleanMob(s?: string): string | undefined {
  if (!s) return undefined
  return s.replace(/['`’]s$/i, '').trim() || undefined
}

/** True if a line looks like damage but we couldn't classify it (for the miss log). */
export function looksDamage(text: string): boolean {
  return /\bfor \d+ points? of|\bhas taken \d+ damage/.test(text)
}
