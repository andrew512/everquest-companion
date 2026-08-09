// TOOLTIP AFFORDANCE — the app-wide rule, pinned structurally.
//
// Owner rule (2026-08-04): "anything wearing a MUI Tooltip shows the HAND". That is a property of
// ~130 call sites, so it is only true if it is CENTRAL: every site imports `lib/Tooltip`, which
// clones one class onto its anchor, and the theme carries that class's single cursor rule. A test
// that rendered one component would prove nothing about the other 129 — what has to be pinned is
// that no site can opt out by accident.
//
// So this suite reads the TREE, not a DOM:
//   1. nobody imports MUI's Tooltip directly (that is the only way to get an anchor with no class);
//   2. the class the wrapper applies and the class the theme styles are the same string;
//   3. the theme states both the rule and its disabled-control exception;
//   4. UpdateChip mounts no MUI Tooltip at all — the nav's update indicator sits directly under
//      Preferences, and a `placement="top"` popper there is an overlay across the row the user was
//      aiming at (the owner's report). Structural, because "the popper cannot mount" is exactly
//      what "it can't eat the click" means.
//   5. the LOOT LEDGER mounts none either (JOS-127) — same defect, one surface wider. A 0.14.0
//      user could not change the Loot sort off "Last looted": the notable-pickups chips and the
//      item names in the first table rows anchored `placement="top"`, INTERACTIVE
//      `KnownItemTooltip` cards, which open upward across the toolbar the Sort select lives in
//      and hold `pointer-events: auto` for as long as they are up. Owner direction was removal,
//      not a timeout or a placement flip, so the guard is the same structural one: no file that
//      draws the ledger may mount a popper of any kind.
//
// No DOM, no fixture — it never skips.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const RENDERER = join(ROOT, 'src', 'renderer', 'src')
/** The ONE file allowed to know MUI's Tooltip exists. */
const WRAPPER = join(RENDERER, 'lib', 'Tooltip.tsx')

function sources(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) sources(p, out)
    else if (/\.tsx?$/.test(e.name)) out.push(p)
  }
  return out
}

/** Does this file import MUI's Tooltip — as a named member, or from its own subpath? */
function importsMuiTooltip(src: string): boolean {
  if (/from '@mui\/material\/Tooltip'/.test(src)) return true
  const named = /import \{([^}]*)\} from '@mui\/material'/.exec(src)
  if (!named) return false
  return named[1]
    .split(',')
    .map((s) => s.trim())
    .some((m) => m === 'Tooltip' || m.startsWith('Tooltip as '))
}

test('lib/Tooltip.tsx is the ONLY importer of MUI’s Tooltip', () => {
  const offenders = sources(RENDERER)
    .filter((f) => f !== WRAPPER && importsMuiTooltip(readFileSync(f, 'utf8')))
    .map((f) => relative(ROOT, f))
  assert.deepEqual(offenders, [], `these bypass the shared wrapper: ${offenders.join(', ')}`)
})

test('every tooltip site goes through the wrapper (it is genuinely used, not just available)', () => {
  const users = sources(RENDERER).filter(
    (f) => f !== WRAPPER && /from '.*lib\/Tooltip'/.test(readFileSync(f, 'utf8'))
  )
  // A floor, not a count: the sweep covered 47 files, and the number only grows.
  assert.ok(users.length >= 40, `only ${String(users.length)} files import the shared Tooltip`)
})

test('the wrapper’s class and the theme’s rule are the same string', () => {
  const wrapper = readFileSync(WRAPPER, 'utf8')
  const theme = readFileSync(join(RENDERER, 'theme', 'theme.ts'), 'utf8')
  const declared = /TIP_ANCHOR_CLASS = '([^']+)'/.exec(wrapper)
  assert.ok(declared, 'the wrapper declares TIP_ANCHOR_CLASS')
  const cls = declared[1]
  assert.equal(cls, 'eq-tip-anchor')
  assert.ok(wrapper.includes('cursor?:'), 'the wrapper offers the documented opt-out')
  assert.ok(theme.includes(`.${cls}`), 'the theme styles the class the wrapper applies')
})

test('the theme states the hand cursor AND the disabled exception', () => {
  const theme = readFileSync(join(RENDERER, 'theme', 'theme.ts'), 'utf8')
  const block = /const tooltipAnchors = \{([\s\S]*?)\n\}/.exec(theme)
  assert.ok(block, 'the theme carries a tooltipAnchors block')
  assert.ok(/cursor: 'pointer'/.test(block[1]), 'anchors get the hand')
  assert.ok(/cursor: 'not-allowed'/.test(block[1]), 'disabled controls keep not-allowed')
  assert.ok(/:has\(\.Mui-disabled\)/.test(block[1]), 'the disabled rule reaches the wrapping span')
  assert.ok(theme.includes('...tooltipAnchors'), 'and the block is actually applied by CssBaseline')
})

/**
 * The files that draw the Loot LEDGER — the toolbar (with the Sort select), the strip under it,
 * the table, its rows and their badges, and the drill-down's own chrome. Not the drill-down BODY:
 * `ItemDetailDialog` and the sections it composes also render inside the Mobs tab's dialog, and
 * their `db`/`observed` provenance chips are two-word labels that cannot sit over any control.
 */
const LOOT_LEDGER = [
  'loot/LootView.tsx',
  'loot/LootTables.tsx',
  'loot/lootRows.tsx',
  'loot/KnowledgeBadge.tsx',
  'loot/NotablePickupsStrip.tsx',
  'loot/ItemDetailPane.tsx',
  // The timeslice control (JOS-130) draws on this surface too, and it is the WORST place left for
  // a popper: it is a row of small toggle buttons sitting directly above the toolbar it governs,
  // so a `placement="top"` card anchored on any of them would open across the ledger's own
  // controls — and one anchored on a button would cover the button beside it. Same rule, same
  // reason, one surface wider.
  'timeslice/SliceBar.tsx'
]

test('the Loot ledger mounts NO tooltip popper over its own controls (JOS-127)', () => {
  for (const name of LOOT_LEDGER) {
    const src = readFileSync(join(RENDERER, 'features', name), 'utf8')
    assert.equal(importsMuiTooltip(src), false, `${name} must not import MUI’s Tooltip`)
    assert.ok(!/from '.*lib\/Tooltip'/.test(src), `${name} must not import the shared Tooltip`)
    // KnownItemTooltip is the WORST of them here: interactive, `placement="top"`, up to 380px
    // wide, and anchored on rows that sit directly beneath the toolbar. Matched as an IMPORT and
    // as an ELEMENT, never as a bare word — these files explain in prose why it left.
    assert.ok(!/from '.*KnownItemTooltip'/.test(src), `${name} must not import the item hover card`)
    assert.ok(!/<KnownItemTooltip/.test(src), `${name} must not mount the item hover card`)
    assert.ok(!/<Tooltip/.test(src), `no Tooltip element may survive in ${name}`)
  }
})

test('the Loot ledger does not smuggle the hover text back in as a native title', () => {
  // A native `title` cannot eat a click (no hit area), so it is not the defect — but the owner's
  // direction was FEWER tooltips on this surface, not a quieter spelling of the same ones.
  for (const name of LOOT_LEDGER) {
    const src = readFileSync(join(RENDERER, 'features', name), 'utf8')
    assert.ok(!/\btitle=/.test(src), `${name} should carry no hover text at all`)
  }
})

test('the estimate caveat survives as a WORD in the header, not a sentence in a popper', () => {
  const tables = readFileSync(join(RENDERER, 'features', 'loot', 'LootTables.tsx'), 'utf8')
  assert.ok(tables.includes('In inventory (est.)'), 'the column header says est. out loud')
})

test('the nav’s update indicator mounts NO tooltip popper over Preferences', () => {
  const chip = readFileSync(join(RENDERER, 'components', 'UpdateChip.tsx'), 'utf8')
  assert.equal(importsMuiTooltip(chip), false, 'UpdateChip must not import a Tooltip')
  assert.ok(!/from '.*lib\/Tooltip'/.test(chip), '…nor the shared one')
  assert.ok(!/<Tooltip/.test(chip), 'no Tooltip element survives in the file')
  // The strings it used to carry are native `title` attributes: an OS tooltip is not in the DOM
  // and has no hit area, so it cannot intercept the click aimed at the row above.
  assert.ok(/title="Only the installed app auto-updates\./.test(chip))
  assert.ok(/title=\{tip\}/.test(chip))
})
