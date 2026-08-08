// captures.ts — the `$<name>` PLACEHOLDER primitive: the syntax, the substitution, and the
// whitespace rule that goes with it.
//
// WHY IT IS NOT IN speechText.ts ANY MORE. It started there because speech was the only thing
// that could say a captured value, and it was module-private. It is not a speech fact: a firing's
// NAMED VALUES (`FiredAlert.captures`) are an ALERTS-wide namespace with two sources — the
// matched event's own scalar fields and the trigger's regex named groups, merged in
// main/modules/alerts.ts — and any surface that renders what an alert matched resolves against
// the same namespace with the same syntax. Text overlays were the second such surface
// (docs/plans/alert-text-overlays.md); a third must not need a third copy of this regex.
//
// speechText.ts imports these and re-exports `placeholdersIn`, so nothing that already used it
// moved. The declarations below are UNCHANGED from the ones it held — this was a move, and
// tests/speechText.test.mts passing untouched is what says so.
//
// THE SYNTAX IS JAVASCRIPT'S OWN. `$<name>` is exactly how a named group is spelled at the other
// end (`(?<mob>.+)`), so a phrase reads like the regex that feeds it and there is one spelling to
// learn rather than two. It also cannot collide with text anyone meant literally: `$<` is not a
// sequence that appears in a sentence someone wanted read aloud or printed over their game.
//
// AN UNRESOLVED NAME IS DROPPED, NOT RENDERED (owner decision). A group that did not participate
// in the match, or a name typed with a typo, substitutes to nothing and the surrounding
// whitespace collapses — so `$<mob> resisted $<spell>` with no spell reads "a froglok resisted"
// rather than printing punctuation. If the WHOLE template resolves to nothing, each caller's
// alertName fallback takes over: still never silent, still never a guess.

/**
 * A placeholder occurrence. The name is restricted to what JS actually accepts as a group name's
 * leading-ASCII case (`(?<1bad>…)` is a SyntaxError), so a pattern that cannot exist on the
 * regex side cannot be written on the template side either.
 */
export const PLACEHOLDER_RE = /\$<([A-Za-z_$][A-Za-z0-9_$]*)>/g

/** Replace every `$<name>` with its captured value, or with nothing when there is none. */
export function substitute(text: string, captures: Record<string, string> | undefined): string {
  if (!text.includes('$<')) return text
  return text.replace(PLACEHOLDER_RE, (_match, name: string) => captures?.[name] ?? '')
}

/** Every distinct `$<name>` a template references, in first-appearance order. */
export function placeholdersIn(phrase: string): string[] {
  const names = new Set<string>()
  for (const m of phrase.matchAll(PLACEHOLDER_RE)) names.add(m[1])
  return [...names]
}

/**
 * Trim + collapse runs of whitespace. Lives here beside `substitute` because it is half of the
 * same rule: a dropped placeholder leaves a hole, and the hole has to close. (A newline in a
 * template is a pause when spoken and a wrap when drawn — neither is a word break.)
 */
export function tidy(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}
