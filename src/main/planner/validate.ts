// planner/validate.ts — the one place a set of exaltation plans is proven to be a set of
// exaltation plans.
//
// TWO CALLERS, ONE ANSWER (the ipc/knowledge + presencePrefs arrangement):
//   * `IPC.plannerSetPlans` runs it on the way IN. Renderer input is never trusted here, exactly
//     as `combo:setCorrection` and `sounds:getData` are not trusted — today's only caller being
//     the app's own UI is not a security property.
//   * `store.getExaltPlans` runs it on the way OUT, so a hand-edited (or downgrade-written)
//     progress file cannot hand the renderer a shape it will crash on.
// Because both directions pass through here, "what is a valid plan" has exactly one definition
// and the round trip is a fixed point — which is what `tests/plannerStore.test.mts` asserts.
//
// It STRIPS rather than rejects (the profiles/share precedent): an unknown slot key, a fifth
// socket type, a class abbreviation that is not one of the sixteen, a socket with no donor —
// each is dropped and everything else is kept. Refusing the whole write over one bad field would
// lose a user's real work to a typo in a file they may never have edited.
//
// Electron-free and dependency-light on purpose: store.ts imports it from module scope.

import { isClassAbbr, MAX_COMBO_SLOTS, type ClassAbbr } from '../../shared/classCombo'
import {
  EQUIP_SLOTS,
  SOCKET_TYPES,
  type ClassesProvenance,
  type EquipSlot,
  type ExaltPlan,
  type PlanSlot,
  type PlanSocket,
  type SocketType
} from '../../shared/planner/types'

/** Bounds. Generous — they exist to stop a runaway write, not to tell the user how to plan. */
const MAX_PLANS = 100
const MAX_ID_CHARS = 128
const MAX_NAME_CHARS = 120

const SLOT_SET: ReadonlySet<string> = new Set<string>(EQUIP_SLOTS)
const SOCKET_SET: ReadonlySet<string> = new Set<string>(SOCKET_TYPES)

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** A non-empty string, trimmed and capped. `undefined` for anything else. */
function text(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.trim().slice(0, max)
  return t === '' ? undefined : t
}

/** A finite timestamp, or `fallback`. Never NaN — a NaN `updatedAt` sorts a set out of existence. */
function stamp(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

/** The target trio: the 16 known abbreviations only, de-duplicated, at most MAX_COMBO_SLOTS. */
function classes(v: unknown): ClassAbbr[] {
  if (!Array.isArray(v)) return []
  const out: ClassAbbr[] = []
  for (const c of v) {
    if (isClassAbbr(c) && !out.includes(c) && out.length < MAX_COMBO_SLOTS) out.push(c)
  }
  return out
}

/**
 * V2's provenance flag, and it is DROPPED rather than defaulted when it is absent or unknown.
 * Absent already means `user` to every reader (types.ts), so writing one in would change a stored
 * set's bytes for no change in meaning — and this function is the read path too, where that would
 * rewrite files the planner never touched.
 */
function provenance(v: unknown): ClassesProvenance | undefined {
  return v === 'detected' || v === 'user' ? v : undefined
}

function planSocket(v: unknown): PlanSocket | undefined {
  if (!isRecord(v)) return undefined
  const effect = text(v.effect, MAX_NAME_CHARS)
  const donorKey = text(v.donorKey, MAX_ID_CHARS)
  // Both halves or nothing: a socket naming an effect with no donor cannot be farmed, and one
  // naming a donor with no effect cannot say what it would extract.
  return effect && donorKey ? { effect, donorKey } : undefined
}

function planSlot(v: unknown): PlanSlot | undefined {
  if (!isRecord(v)) return undefined
  const sockets: Partial<Record<SocketType, PlanSocket>> = {}
  const raw = isRecord(v.sockets) ? v.sockets : {}
  for (const [name, value] of Object.entries(raw)) {
    if (!SOCKET_SET.has(name)) continue
    const socket = planSocket(value)
    if (socket) sockets[name as SocketType] = socket
  }
  const hostKey = text(v.hostKey, MAX_ID_CHARS)
  const hostName = text(v.hostName, MAX_NAME_CHARS)
  const slot: PlanSlot = { sockets }
  if (hostKey) slot.hostKey = hostKey
  if (hostName) slot.hostName = hostName
  // An empty cell is not a plan: no host, no sockets, nothing to store.
  return slot.hostKey || Object.keys(sockets).length > 0 ? slot : undefined
}

function planSlots(v: unknown): Partial<Record<EquipSlot, PlanSlot>> {
  const out: Partial<Record<EquipSlot, PlanSlot>> = {}
  if (!isRecord(v)) return out
  for (const [name, value] of Object.entries(v)) {
    if (!SLOT_SET.has(name)) continue
    const slot = planSlot(value)
    if (slot) out[name as EquipSlot] = slot
  }
  return out
}

/** One plan, or `undefined` when it carries no usable identity (an id is the CRUD handle). */
function exaltPlan(v: unknown, now: number): ExaltPlan | undefined {
  if (!isRecord(v)) return undefined
  const id = text(v.id, MAX_ID_CHARS)
  if (!id) return undefined
  const createdAt = stamp(v.createdAt, now)
  const from = provenance(v.classesProvenance)
  const plan: ExaltPlan = {
    id,
    name: text(v.name, MAX_NAME_CHARS) ?? 'Untitled set',
    classes: classes(v.classes),
    createdAt,
    updatedAt: stamp(v.updatedAt, createdAt),
    slots: planSlots(v.slots)
  }
  if (from !== undefined) plan.classesProvenance = from
  return plan
}

/**
 * Whatever the renderer (or the store file) offered → the plans this app will actually keep.
 * Never throws, never rejects the batch: unusable entries are dropped, duplicate ids keep the
 * FIRST occurrence (the renderer's own list order is the user's order).
 */
export function sanitizeExaltPlans(raw: unknown, now: number = Date.now()): ExaltPlan[] {
  if (!Array.isArray(raw)) return []
  const out: ExaltPlan[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    if (out.length >= MAX_PLANS) break
    const plan = exaltPlan(entry, now)
    if (!plan || seen.has(plan.id)) continue
    seen.add(plan.id)
    out.push(plan)
  }
  return out
}
