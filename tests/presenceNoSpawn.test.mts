// NO SHIPPED CODE CAN SPAWN POWERSHELL (JOS-182).
//
// The presence watcher was a hidden `powershell.exe` launched with
// `-ExecutionPolicy Bypass -EncodedCommand <base64>`, which compiled C# at runtime and enumerated
// every process on the machine. To a behavioural antivirus engine that is an infostealer, and this
// app was the most-flagged thing its author had ever shipped. It also simply did not exist on
// hundreds of installs' worth of machines, where the spawn was an ENOENT and both features it
// drives were dead for every session.
//
// The fix was to stop spawning anything at all. `tests/presence.test.mts` pins what the watcher
// DOES and `tests/presenceWorker.test.mts` runs it — but "no code path can start that process" is
// a property of the whole source tree rather than of any module, so this file reads the tree. It
// is here rather than folded into either of those because it is the only presence test that
// touches a disk, and because it outlives them: it stays true of code nobody has written yet.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')

/**
 * THE ONE EXEMPTION, and it is prose rather than a loophole.
 *
 * `shared/releaseNotes.ts` is the app's own history, rendered in the What's-new panel. The release
 * that removed the PowerShell watcher has to be able to SAY so — a note that cannot name the thing
 * it took away is a note that explains nothing to the player whose antivirus was shouting at them.
 * Nothing in that module is executable in any sense; it is a list of sentences.
 */
const NOT_CODE = new Set(['shared/releaseNotes.ts'])

/** A path relative to src/, spelled the same way on every platform. */
function key(file: string): string {
  return relative(SRC_ROOT, file).replace(/\\/g, '/')
}

/** Every .ts/.tsx under src/, recursively. */
function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sourceFiles(full))
    else if (/\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

/** The text of every string literal and template chunk in a file — i.e. what the program can say,
 *  as opposed to what its author wrote about. */
function literalText(file: string): string[] {
  const src = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const found: string[] = []
  const visit = (node: ts.Node): void => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      found.push(node.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(src)
  return found
}

test('NO SHIPPED CODE CAN NAME POWERSHELL — the watcher spawns nothing at all now', () => {
  const files = sourceFiles(SRC_ROOT)
  assert.ok(files.length > 100, 'the walk found the tree, or this test proves nothing')
  const offenders: string[] = []
  let exempted = 0
  for (const file of files) {
    if (NOT_CODE.has(key(file))) {
      exempted++
      continue
    }
    for (const text of literalText(file)) {
      if (/powershell|pwsh/i.test(text)) {
        offenders.push(`${key(file)}: ${JSON.stringify(text.slice(0, 80))}`)
      }
    }
  }
  assert.deepEqual(offenders, [], 'a string literal names PowerShell')
  // The exemption must still be REACHED, or a rename would silently turn it into a second guard
  // over nothing while looking exactly as green as it does today.
  assert.equal(exempted, NOT_CODE.size, 'every exempt file is still there to be exempted')
})

test('THE PRESENCE MODULES SPAWN NOTHING — no child-process API is even in scope', () => {
  for (const name of [
    'presence.ts',
    'presenceEffects.ts',
    'presenceNative.ts',
    'presenceProtocol.ts',
    'presenceWorker.ts'
  ]) {
    const file = join(SRC_ROOT, 'main', name)
    const src = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
    const imports = src.statements
      .filter(ts.isImportDeclaration)
      .map((d) => (ts.isStringLiteral(d.moduleSpecifier) ? d.moduleSpecifier.text : ''))
    for (const spec of imports) {
      assert.doesNotMatch(spec, /child_process/, `${name} imports ${spec}`)
    }
  }
})
