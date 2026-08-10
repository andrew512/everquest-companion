/**
 * sync-upstream.mts — pull the original project's main into this fork's main.
 *
 *   npm run sync:upstream            Fetch jmoyers/everquest-companion and bring
 *                                    the local `main` up to date with its `main`.
 *                                    Fast-forward when this fork's main has no
 *                                    commits of its own; a merge commit when it
 *                                    does.
 *
 *   npm run sync:upstream -- --push  ...and push the result to origin/main.
 *   npm run sync:upstream -- --rebase   Replay this fork's own main commits on
 *                                    top of upstream instead of merging.
 *
 * You do NOT have to be on main. When main is not the checked-out branch and the
 * update is a fast-forward, the ref is moved directly (`git fetch upstream
 * main:main`), so the working tree — and whatever feature branch you are on — is
 * left completely alone. Only a genuine divergence needs main checked out, and
 * the script says so rather than switching branches behind your back.
 *
 * The `upstream` remote is created on first run. Point it somewhere else with
 * UPSTREAM_URL, or rename the remote with UPSTREAM_REMOTE.
 */

import { execFileSync } from 'node:child_process'

const UPSTREAM_URL =
  process.env.UPSTREAM_URL ?? 'https://github.com/jmoyers/everquest-companion.git'
const UPSTREAM_REMOTE = process.env.UPSTREAM_REMOTE ?? 'upstream'
const BRANCH = process.env.UPSTREAM_BRANCH ?? 'main'

const argv = process.argv.slice(2)
const PUSH = argv.includes('--push')
const REBASE = argv.includes('--rebase')

/** Run git, streaming its output to the terminal. Throws on a non-zero exit. */
function git(...args: string[]): void {
  console.log(`  git ${args.join(' ')}`)
  execFileSync('git', args, { stdio: 'inherit' })
}

/** Run git and capture stdout. Returns null instead of throwing on failure. */
function capture(...args: string[]): string | null {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch {
    return null
  }
}

function die(message: string, ...detail: string[]): never {
  console.error(`\n✗ ${message}`)
  for (const line of detail) console.error(`  ${line}`)
  process.exit(1)
}

// ---------------------------------------------------------------- the remote

const existing = capture('remote', 'get-url', UPSTREAM_REMOTE)
if (existing === null) {
  console.log(`Adding remote '${UPSTREAM_REMOTE}' → ${UPSTREAM_URL}`)
  git('remote', 'add', UPSTREAM_REMOTE, UPSTREAM_URL)
} else if (existing !== UPSTREAM_URL) {
  console.log(`Remote '${UPSTREAM_REMOTE}' already points at ${existing} — using that.`)
}

console.log(`\nFetching ${UPSTREAM_REMOTE}/${BRANCH}...`)
git('fetch', UPSTREAM_REMOTE, BRANCH, '--tags')

// ------------------------------------------------------- where we stand

const target = `${UPSTREAM_REMOTE}/${BRANCH}`
const targetSha = capture('rev-parse', '--verify', target)
if (targetSha === null) die(`${target} does not exist after fetching.`)

const localSha = capture('rev-parse', '--verify', `refs/heads/${BRANCH}`)
if (localSha === null) {
  console.log(`\nNo local '${BRANCH}' yet — creating it from ${target}.`)
  git('branch', BRANCH, target)
  process.exit(0)
}

const counts = capture('rev-list', '--left-right', '--count', `refs/heads/${BRANCH}...${target}`)
const [ahead, behind] = (counts ?? '0\t0').split(/\s+/).map(Number)

console.log(
  `\n${BRANCH}: ${behind} commit(s) behind ${target}` +
    (ahead > 0 ? `, ${ahead} of its own not upstream` : ''),
)

if (behind === 0 && ahead === 0) {
  console.log(`✓ Already up to date with ${target}.`)
} else if (behind === 0) {
  console.log(`✓ Nothing to pull — ${BRANCH} is ahead of ${target} only.`)
} else {
  const current = capture('rev-parse', '--abbrev-ref', 'HEAD')
  const onBranch = current === BRANCH

  if (ahead === 0 && !onBranch) {
    // Pure fast-forward and main is not checked out: move the ref, leave the
    // working tree (and the branch you are actually on) untouched.
    console.log(`\nFast-forwarding ${BRANCH} without leaving '${current}'...`)
    git('fetch', UPSTREAM_REMOTE, `${BRANCH}:${BRANCH}`)
  } else {
    if (!onBranch) {
      die(
        `${BRANCH} has ${ahead} commit(s) of its own, so this needs a real ${REBASE ? 'rebase' : 'merge'}.`,
        `You are on '${current}'. Switch over and re-run:`,
        `  git switch ${BRANCH} && npm run sync:upstream${REBASE ? ' -- --rebase' : ''}`,
      )
    }
    const dirty = capture('status', '--porcelain', '--untracked-files=no')
    if (dirty) {
      die(
        `${BRANCH} has uncommitted changes — commit or stash them first.`,
        ...dirty.split('\n').map((l) => l.trim()),
      )
    }
    console.log(`\n${REBASE ? 'Rebasing' : 'Merging'} ${target} into ${BRANCH}...`)
    try {
      if (REBASE) git('rebase', target)
      else git('merge', '--no-edit', target)
    } catch {
      die(
        `The ${REBASE ? 'rebase' : 'merge'} stopped — most likely on conflicts.`,
        'Resolve them, then finish with:',
        REBASE ? '  git rebase --continue' : '  git commit',
        `Or back out entirely with: git ${REBASE ? 'rebase' : 'merge'} --abort`,
      )
    }
  }
  console.log(`\n✓ ${BRANCH} is now at ${capture('rev-parse', '--short', `refs/heads/${BRANCH}`)}.`)
}

// ---------------------------------------------------------------- the push

if (PUSH) {
  console.log(`\nPushing ${BRANCH} to origin...`)
  git('push', 'origin', `${BRANCH}:${BRANCH}`)
  console.log('✓ origin/' + BRANCH + ' updated.')
} else {
  const unpushed = capture('rev-list', '--count', `origin/${BRANCH}..refs/heads/${BRANCH}`)
  if (unpushed && unpushed !== '0') {
    console.log(
      `\n${unpushed} commit(s) not yet on origin/${BRANCH}.` +
        `\nPublish them with: npm run sync:upstream -- --push`,
    )
  }
}
