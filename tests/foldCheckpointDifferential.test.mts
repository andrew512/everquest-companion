/**
 * ============================================================================
 * foldCheckpointDifferential.test.mts — THE OWNER'S LAW, AS A TEST (JOS-208).
 * ============================================================================
 *
 *     restore(checkpoint(fold(prefix))) + fold(tail)   ==   fold(prefix + tail)
 *
 * asserted with DEEP-EQUAL published snapshots of the pilot modules, over the fixture corpus, at a
 * matrix of split points: session edges, zone lines, mid-fight, mid-hold, deciles, and seeded
 * fuzz. Then the externality permutations — a log that was truncated, regrown, or edited under the
 * checkpoint, and a cache that is missing, corrupt, or from another build — every one of which
 * must land on the COLD PATH and produce the cold answer.
 *
 * WHY DEEP-EQUAL AND NOT "CLOSE ENOUGH": the failure this guards against is a silently wrong world
 * model, and every wrong world model starts as one field that nobody thought worth comparing. The
 * comparison is `assert.deepStrictEqual` over the whole snapshot object including its `seq`, which
 * for `respawn` is its own revision counter and therefore has to survive the round trip too.
 *
 * THE HARNESS is `foldCheckpointHarness.mts`; read its header for what makes the two arms the same
 * program, and for why every split is snapped to a line boundary.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  buildFoldWorld,
  checkpointBytes,
  foldRange,
  FOLD_FIXTURES,
  publishedSnapshots,
  restoreInto,
  splitPoints,
  watchesFor
} from './foldCheckpointHarness.mts'
import { readCheckpoint, writeCheckpoint, type RestoreResult } from '../src/main/foldCache/loader'
import { PILOT_MODULE_IDS } from '../src/main/foldCache/serialize'
import type { RespawnPrefs } from '../src/shared/respawn'

const FIXTURES = join(import.meta.dirname, 'fixtures')
const fixturePath = (name: string): string => join(FIXTURES, name)

/** The COLD arm: one fold of the whole file. Cached per fixture — it is the same answer every time. */
async function coldSnapshots(logPath: string, prefs: RespawnPrefs): Promise<Record<string, unknown>> {
  const world = buildFoldWorld(logPath, prefs)
  await foldRange(world, logPath, { from: 0, seq: 0 })
  return publishedSnapshots(world)
}

/**
 * The WARM arm: fold [0, B), write a real container, restore it into a FRESH world, fold [B, EOF).
 *
 * A fresh world rather than the same one, deliberately — restoring into the module that produced
 * the state would prove that assigning a value to itself is a no-op. The fresh world has been
 * `reset()` exactly as `session.ts` resets it before a restore.
 */
async function warmSnapshots(logPath: string, b: number, prefs: RespawnPrefs): Promise<Record<string, unknown>> {
  const prefix = buildFoldWorld(logPath, prefs)
  const at = await foldRange(prefix, logPath, { from: 0, to: b, seq: 0 })
  const container = checkpointBytes(prefix, logPath, { offset: at.endOffset, seq: at.seq })

  const warm = buildFoldWorld(logPath, prefs)
  const seq = restoreInto(warm, container)
  assert.notEqual(seq, null, 'the container this test just wrote must decode')
  await foldRange(warm, logPath, { from: at.endOffset, seq: seq ?? 0 })
  return publishedSnapshots(warm)
}

// ---------------------------------------------------------------- the split-point matrix

for (const fixture of FOLD_FIXTURES) {
  test(`fold checkpoint: ${fixture} — cold == checkpoint+tail at every split`, async () => {
    const logPath = fixturePath(fixture)
    const bytes = readFileSync(logPath)
    const prefs = await watchesFor(logPath)
    const cold = await coldSnapshots(logPath, prefs)
    const splits = splitPoints(bytes, hashSeed(fixture))
    assert.ok(splits.length >= 5, `${fixture} must yield a real matrix, got ${splits.length}`)

    for (const split of splits) {
      const warm = await warmSnapshots(logPath, split.offset, prefs)
      for (const id of PILOT_MODULE_IDS) {
        assert.deepStrictEqual(
          warm[id],
          cold[id],
          `${fixture} @ ${split.label} (byte ${split.offset}): module '${id}' diverged`
        )
      }
    }
  })
}

/** A stable per-fixture fuzz seed, so a red run names a matrix anybody can reproduce exactly. */
function hashSeed(name: string): number {
  let h = 2166136261
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

// ------------------------------------------------------------- the externality permutations

/**
 * EVERY WAY THE WORLD CAN MOVE UNDER A CHECKPOINT, and the one thing they must all do: refuse.
 *
 * The externalities run through the REAL loader (`writeCheckpoint` / `readCheckpoint`) rather than
 * through the harness's encoder, because the thing under test here is the validation ladder — the
 * identity block, the two invalidation axes, the container digests — and that ladder lives in the
 * loader. Each case asserts a SPECIFIC refusal reason, not merely "false": a truncation that were
 * to be refused for the wrong reason (say a digest failure rather than the size floor) would be a
 * check passing by accident, and the next edit could take the real one away unnoticed.
 */
test('fold checkpoint: every externality lands on the cold path', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'eqfold-'))
  const logPath = join(dir, 'eqlog_Primitive_freeport.txt')
  const cachePath = join(dir, 'cache.eqfold')
  const source = readFileSync(fixturePath('e2e-combat.log'))
  writeFileSync(logPath, source)

  const prefs = await watchesFor(logPath)
  const world = buildFoldWorld(logPath, prefs)
  // MID-FILE ON PURPOSE, and named rather than indexed. The externalities below edit bytes at
  // 64–96 KB, so a split at, say, byte 400 would leave the whole identity window untouched and the
  // "regrown" case would correctly restore — a green test asserting nothing. The first cut of this
  // test did exactly that and said so loudly, which is the only reason this comment exists.
  const half = splitPoints(source, 1).find((s) => s.label === 'decile-50')
  // Past 96 KB, so the 64 KB shoulder ending at B genuinely covers the 64–96 KB the cases below cut.
  assert.ok(half && half.offset > 96 * 1024, `the split must sit past the edited window (${half?.offset})`)
  const at = await foldRange(world, logPath, { from: 0, to: half.offset, seq: 0 })
  const units = world.units

  const write = async (): Promise<void> => {
    const ok = await writeCheckpoint({
      cachePath,
      logPath,
      characterKey: 'primitive@freeport',
      offset: at.endOffset,
      seq: at.seq,
      lastEventTs: 0,
      modules: units
    })
    assert.equal(ok, true, 'the checkpoint must write')
  }
  const read = async (): Promise<RestoreResult> => {
    // A FRESH world per read: a loader that restored into already-restored modules could return
    // true without having done anything.
    const w = buildFoldWorld(logPath, prefs)
    return readCheckpoint({
      cachePath,
      logPath,
      characterKey: 'primitive@freeport',
      modules: w.units
    })
  }

  // 0. THE CONTROL. Everything below is a mutation of this, so if this ever stops passing the rest
  //    of the test is measuring nothing.
  await write()
  assert.deepStrictEqual(await read(), {
    restored: true,
    offset: at.endOffset,
    seq: at.seq,
    lastEventTs: 0
  })

  // 1. MISSING CACHE — the ordinary first launch.
  const other = join(dir, 'nothing.eqfold')
  const w0 = buildFoldWorld(logPath, prefs)
  const missing = await readCheckpoint({
    cachePath: other,
    logPath,
    characterKey: 'primitive@freeport',
    modules: w0.units
  })
  assert.deepStrictEqual(missing, { restored: false, why: 'missing' })

  // 2. TRUNCATED LOG — the file is now shorter than the byte the checkpoint describes. Caught by
  //    the size floor, before a single byte is read.
  writeFileSync(logPath, source.subarray(0, Math.floor(at.endOffset / 2)))
  assert.deepStrictEqual(await read(), { restored: false, why: 'identity:shrank' })

  // 3. REGROWN LOG — truncated and refilled past B with DIFFERENT bytes. The size test passes and
  //    the shoulder is what catches it. This is the case the whole identity block exists for.
  writeFileSync(logPath, Buffer.concat([source.subarray(0, 64 * 1024), source.subarray(96 * 1024)]))
  const regrown = await read()
  assert.equal(regrown.restored, false)
  assert.match(regrown.restored ? '' : regrown.why, /^identity:(shoulder|last-line|block|head)$/)

  // 4. A FLIPPED BYTE IN THE SHOULDER — the smallest possible edit, in the window that matters
  //    most. One byte, and the answer is a cold start.
  const flipped = Buffer.from(source)
  const shoulderByte = at.endOffset - 1024
  flipped[shoulderByte] = (flipped[shoulderByte] ?? 0) ^ 0x01
  writeFileSync(logPath, flipped)
  assert.deepStrictEqual(await read(), { restored: false, why: 'identity:shoulder' })

  // 5. THE LOG IS FINE AGAIN — so the control still holds, proving 2–4 were about the log and not
  //    about the cache having been damaged along the way.
  writeFileSync(logPath, source)
  assert.equal((await read()).restored, true)

  // 6. CORRUPT CACHE — one byte flipped inside a module blob. The per-blob digest catches it
  //    without the header or the identity check ever being reached.
  const good = readFileSync(cachePath)
  const corrupt = Buffer.from(good)
  const mid = Math.floor(corrupt.length / 2)
  corrupt[mid] = (corrupt[mid] ?? 0) ^ 0xff
  writeFileSync(cachePath, corrupt)
  const corruptRes = await read()
  assert.equal(corruptRes.restored, false)
  assert.match(corruptRes.restored ? '' : corruptRes.why, /^decode:/)

  // 7. A TRUNCATED CACHE — a crash mid-write, if the temp+rename had not been there to prevent it.
  writeFileSync(cachePath, good.subarray(0, good.length - 40))
  const cut = await read()
  assert.equal(cut.restored, false)
  assert.match(cut.restored ? '' : cut.why, /^decode:/)

  // 8. STALE SEMANTICS — a checkpoint written by a build whose fold MEANT something else. Forged by
  //    rewriting the header's `foldSemantics`, which is exactly what an older build's file is.
  writeFileSync(cachePath, forgeHeader(good, (h) => ({ ...h, foldSemantics: 999 })))
  assert.deepStrictEqual(await read(), { restored: false, why: 'semantics' })

  // 9. STALE SHAPE — the ENCODING axis. A checkpoint whose module declared a different shape.
  writeFileSync(
    cachePath,
    forgeHeader(good, (h) => ({
      ...h,
      modules: h.modules.map((m, i) => (i === 0 ? { ...m, shapeHash: 'deadbeefdeadbeef' } : m))
    }))
  )
  assert.deepStrictEqual(await read(), { restored: false, why: 'shape' })

  // 10. A DIFFERENT CHARACTER's log at the same path.
  writeFileSync(cachePath, good)
  const w1 = buildFoldWorld(logPath, prefs)
  const wrongChar = await readCheckpoint({
    cachePath,
    logPath,
    characterKey: 'somebodyelse@freeport',
    modules: w1.units
  })
  assert.deepStrictEqual(wrongChar, { restored: false, why: 'identity:character' })
})

/**
 * Rewrite a container's header and re-digest it, so the forged file is INTERNALLY VALID and the
 * test really does exercise the semantics/shape checks rather than the digest that would otherwise
 * reject the edit first. It re-implements the encoder's framing on purpose: a forgery built with
 * the encoder could only ever produce headers the encoder agrees with.
 */
function forgeHeader(container: Buffer, edit: (h: HeaderLike) => HeaderLike): Buffer {
  const sha = (b: Buffer): Buffer => createHash('sha256').update(b).digest()
  const headerLen = container.readUInt32LE(12)
  const oldHeader = container.subarray(16, 16 + headerLen)
  const next = Buffer.from(JSON.stringify(edit(JSON.parse(oldHeader.toString('utf8')) as HeaderLike)), 'utf8')
  const schema = Buffer.alloc(8)
  schema.writeUInt32LE(container.readUInt32LE(8), 0)
  schema.writeUInt32LE(next.length, 4)
  const tail = container.subarray(16 + headerLen + 32, container.length - 32)
  const body = Buffer.concat([container.subarray(0, 8), schema, next, sha(next), tail])
  return Buffer.concat([body, sha(body)])
}

interface HeaderLike {
  foldSemantics: number
  modules: { id: string; shapeHash: string }[]
}
