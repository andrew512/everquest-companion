// GROUP family of the parse cascade (see parser.ts for the ordered list): the lines that say
// WHO YOU ARE WITH. docs/plans/group-model.md §1.
//
// Its own module, beside parseSession.ts, for the same reason that one exists: these are not
// world STATE and they are not combat — they are the frame around both. A group is the answer
// to "whose damage belongs on my meter", which is a question no other family answers.
//
// EVERY SHAPE MEASURED against the real 1,382,093-line log (2026-08-05, eqlog_Primitive_freeport):
//
//   `<Name> has joined the group.`                  5   → join
//   `You have joined the group.`                    5   → selfJoin
//   `<Name> has left the group.`                    2   → leave
//   `You have been removed from the group.`         5   → selfLeave
//   `<Name> is now the leader of your group.`       2   → leader
//   `You are now the leader of your group.`         5   → (consumed, no membership fact)
//   `You invite <Name> to join your group.`         6   → invite
//   `<Name> invites you to join a group.`           3   → invite
//   `<Name> tells the group, '<text>'`             30   → confirm
//   `You tell your party, '<text>'`                22   → (consumed, no membership fact)
//
// 58 `group` events over the whole log, across five distinct names (Dranix, Rykkerr, Rakisar,
// Tromos, Worldseries, Chunkd — the last three invite-only, which is exactly why an invite is
// not a membership fact).
//
// TWO SHAPES ARE UNVERIFIED — they do not occur in this log at all, so they are written from
// the game's own wording of the pair they belong to, tested from synthetic lines, and LABELED
// (the awaiting-sample law, AGENTS.md):
//
//   `<Name> has been removed from the group.`   UNVERIFIED — the third-person twin of the
//       measured `You have been removed from the group.` (what the log prints when the leader
//       kicks someone else). Treated as `leave`.
//   `You remove <Name> from the group.`         UNVERIFIED — the leader's own view of the same
//       act, named by the design doc. Treated as `leave`.
//
// SHADOWING: every one of these lines parsed to `{kind:'unknown'}` before this module existed —
// verified by a full-log kind histogram diffed before/after (tests/groupShapes.test.mts pins the
// individual shapes; scripts are throwaway per AGENTS.md). The chat shapes are the only ones
// that could collide with anything, and nothing in this app parses chat.
//
// TWO LINES THIS FAMILY SEES AND DECLINES (JOS-85, report 01KZEWFNSEHJN33W1BA797F806) — named
// here so the next reader knows they were read and refused, not missed. Both are in that
// reporter's slice and both still parse to `{kind:'unknown'}`:
//
//   `Player <Name> creating instance <Zone> <N>.`
//   `<Zone> - Group is now available to you.`
//
// The design doc (§1) expected an EQ Legends instance ROSTER family here (`X has been added to
// <instance> - Group.`). Whatever that family looks like, these two are not it. The second names
// nobody at all. The first names the instance's CREATOR — and in the ONE occurrence this app has
// ever observed, the creator is the tailed character himself, so nothing in it says whether a
// creator who is NOT you is in your group or merely someone whose instance you were handed.
// Under the awaiting-sample law that is not enough to write a membership rule from, and a
// membership event that carries no membership fact would only set `seen` — which would flip the
// Group scope out of its show-everyone fallback and HIDE people, the exact defect the report is
// about. So they stay unknown until a log prints one with somebody else's name in it.
//
// WHY THE CHAT SHAPES ARE HERE AT ALL. `<Name> tells the group, '…'` is the RECOVERY path: EQ
// prints the join line once, so a group formed before the app opened — or before the log file
// rolled — leaves no join line to replay, and the only remaining evidence that someone is with
// you is that they keep talking to your group. It is invisible in every committed fixture and
// every feedback slice, because shared/logScrub.ts drops quoted speech. That is the correct
// trade: the CONTENT of the line never leaves the machine, and only the fact that a name spoke
// to your group is used.
//
// IT IS NOT THE ONLY RECOVERY PATH ANY MORE, because it needs somebody to TALK and a quiet group
// never does — measured: a reporter's 12,376-line session with two group-mates and ZERO group
// events of any kind (JOS-85). The second path is folded by the roster MODULE, not by this file,
// because it is a multi-line shape and nothing here is: one Quick Buff burst enumerating who
// your buffs reached, gated on `You gain party experience!`. src/main/modules/buffFanOut.ts.

import type { GroupEvent, LogEvent } from '../../shared/logEvents'
import type { ClassifyCtx } from './parseCommon'

type GroupChange = GroupEvent['change']

/**
 * A PLAYER NAME as the subject of one of these lines — one word of letters, with the backtick
 * and apostrophe EQ allows. Deliberately NOT `.+?`: a lazy any-match would let a chat line
 * QUOTING one of these sentences (`X tells General:1, 'Y tells the group, hi'`) satisfy the
 * pattern with `X tells General:1, 'Y` as the "name", and every subject in this family is a
 * player, whose name never contains a space. Case is not constrained — the log carries typed
 * lowercase names in the invite lines (`You invite dranix to join your group.`) and idKey()
 * canonicalizes downstream anyway.
 */
const NAME = "([A-Za-z][A-Za-z`'-]*)"

/** `<Name> has joined the group.` — the primary membership signal. */
const JOINED_RE = new RegExp(`^${NAME} has joined the group\\.$`)
/** `<Name> has left the group.` / `<Name> has been removed from the group.` (the latter unverified). */
const LEFT_RE = new RegExp(`^${NAME} has (?:left|been removed from) the group\\.$`)
/** `You remove <Name> from the group.` — UNVERIFIED (see the header). */
const REMOVE_RE = new RegExp(`^You remove ${NAME} from the group\\.$`)
/** `<Name> is now the leader of your group.` — the leader of YOUR group is in it. */
const LEADER_RE = new RegExp(`^${NAME} is now the leader of your group\\.$`)
/** `You invite <Name> to join your group.` — an offer, not a membership fact. */
const INVITE_OUT_RE = new RegExp(`^You invite ${NAME} to join your group\\.$`)
/** `<Name> invites you to join a group.` — likewise an offer. */
const INVITE_IN_RE = new RegExp(`^${NAME} invites you to join a group\\.$`)
/** `<Name> tells the group, '…'` — a member re-asserting they are here. The text is NOT read. */
const GROUP_TELL_RE = new RegExp(`^${NAME} tells the group, '`)

/** The two first-person lines that state a fact about YOU, not about a member. */
const SELF_JOIN_LINE = 'You have joined the group.'
const SELF_LEAVE_LINE = 'You have been removed from the group.'
const SELF_LEADER_LINE = 'You are now the leader of your group.'
const SELF_TELL_PREFIX = "You tell your party, '"

/**
 * The group family. ONE classifier for all of it, because these are one fact — "who is with
 * me" — with several wordings, and because a single `includes` pre-filter rules the whole
 * family out for every combat line at the cost of one substring scan.
 *
 * ORDER INSIDE: the two self EXACT lines are compared before any regex runs, so `You have
 * joined the group.` can never be read as a member named "You" (`.+?` would happily match it).
 *
 * Returns `null` for the lines that carry no membership fact but belong to the family
 * (`You are now the leader of your group.`, `You tell your party, '…'`) — deliberately: an
 * event whose payload is empty is noise on the bus, and the roster learns nothing from either.
 * They are named here so the next reader knows they were seen and dismissed, not missed.
 */
export function classifyGroup({ text, ts, seq, raw }: ClassifyCtx): LogEvent | null {
  if (!text.includes('group') && !text.includes('party')) return null
  if (text === SELF_JOIN_LINE) return { kind: 'group', change: 'selfJoin', seq, ts, raw }
  if (text === SELF_LEAVE_LINE) return { kind: 'group', change: 'selfLeave', seq, ts, raw }
  if (text === SELF_LEADER_LINE || text.startsWith(SELF_TELL_PREFIX)) return null
  const named = namedShape(text)
  return named ? { kind: 'group', change: named.change, name: named.name, seq, ts, raw } : null
}

/** The pattern table for the shapes that NAME someone, tried in order. A table rather than a
 *  chain of ifs so the family reads as the list it is — and so the classifier above stays one
 *  screen and one decision. */
const NAMED: readonly [RegExp, GroupChange][] = [
  [JOINED_RE, 'join'],
  [LEFT_RE, 'leave'],
  [REMOVE_RE, 'leave'],
  [LEADER_RE, 'leader'],
  [INVITE_OUT_RE, 'invite'],
  [INVITE_IN_RE, 'invite'],
  [GROUP_TELL_RE, 'confirm']
]

function namedShape(text: string): { change: GroupChange; name: string } | null {
  for (const [re, change] of NAMED) {
    const m = re.exec(text)
    if (m) return { change, name: m[1] }
  }
  return null
}
