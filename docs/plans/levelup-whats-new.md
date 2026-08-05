# Level-up celebration + "what's new at this level"

Status: DESIGN. Author: planning session (Fable), 2026-08-05. Owner-requested.
Companion to docs/plans/celebration-toasts.md (the toast infra it rides).
Constrained by AGENTS.md: celebrations law (live transitions only), law 1
(messages over inference — unlock data is scraped knowledge, labeled), law 10
(combo intervals join at read), lint ceilings, scraper etiquette.

## 0. What we are building, in one paragraph

When you ding, a **celebration toast** fires ("Level 24!" + "3 new spells ·
2 new skills") and a **"New at this level" panel** in the Leveling tab shows,
for your CURRENT class combo, exactly what just unlocked: **new spells**
(chip per class it belongs to, hover for details — cast time, mana, target,
type, duration from the spell DB) and **new skills** — disciplines, granted
combat skills (Double Attack), innate actives (Smite). The panel is also
browsable by level so it answers "what do I get at 30?" without waiting.

## 1. Data (measured 2026-08-05)

- **Spells: the data already exists.** spells.json (1,926 rows) carries
  `classes: "* Enchanter - Level 37"` — raw wikitext lines, one per class,
  WITH the level. A pure parser (`shared/spellLevels.ts`,
  `parseSpellClasses(text): {cls: ClassAbbr, level: number}[]`) unlocks
  per-class per-level lists at runtime (1.9k strings, trivial). Node-tested
  against the real committed DB with floors; dirty variants measured first.
- **Skills/discs/innates: OVERTURNED by wave O1 (measured) — the wiki DOES
  state unlock levels.** classes.json now carries `skillUnlocks` (450 rows /
  16 classes, incl. 3 structure-derived innates like SHD Harm Touch@1) and
  `discUnlocks` (33 rows / BER MNK RNG ROG). The central Disciplines page's
  "only Rogue poison disciplines are on Legends" statement is quoted into
  `disputed[]` for the 13 non-Rogue rows — O2's panel renders those with an
  honesty chip, never silently. Spell parser: shared/spellLevels.ts
  (2,001 pairs; BER/MNK/WAR have zero Spellpage spells — skills-only
  classes, the panel must not render an empty "new spells" section as an
  error for them).

## 2. Behavior

- Trigger: the existing level-up event (progression module), LIVE only —
  replay/hydration never toast (celebrations law). Multi-ding bursts (rare)
  queue like any toast (cap 3).
- Toast: title "Level 24!", subtitle "<n> new spells · <m> new skills"
  computed against the combo at the ding's timestamp (`comboAt` — law 10:
  intervals join at read). Unresolved combo ⇒ counts across candidate
  classes labeled `~ambiguous` chip style; zero unlocks ⇒ toast still
  celebrates, subtitle just the level.
- Click → main window → Leveling tab, "New at this level" panel anchored at
  that level (nonce routing, the openLoot idiom).
- Panel (features/leveling): level stepper (defaults to current level),
  spells list (name, class chips lit per combo, hover = spell card from
  spells.json fields), skills list (kind chip: disc / skill / innate),
  sourced-from-DB labeling. Windowed/fixed-height per the list law.

## 3. Waves

- **O1 (data):** shared/spellLevels.ts parser + tests; scrape:classes
  extension + regenerated classes.json + tests (structure measured first).
- **O2 (UI):** panel + toast producer + deep link + tests + e2e check.
  O2 dispatches after wave N (shares App.tsx/toast producer files).
