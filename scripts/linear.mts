/**
 * linear.mts — the board is in Linear; this is how the integrator moves it.
 *
 *   npx tsx scripts/linear.mts list [--state "In Progress"]
 *   npx tsx scripts/linear.mts create "Title" --state Backlog [--desc "..."]
 *   npx tsx scripts/linear.mts move JOS-18 "In Progress"
 *   npx tsx scripts/linear.mts comment JOS-18 "E1 doer dispatched (worktree agent)"
 *
 * CANONICAL PROJECT MANAGEMENT (owner decision, 2026-08-05): the kanban in the owner's
 * personal Linear workspace (Josh's Maker Space, team JOS — NEVER the work workspace) is the
 * source of truth for what is being built, by which agent, and where it stands. The
 * integrator moves issues when dispatching (→ In Progress, with a comment naming the wave)
 * and when merging (→ Done, with the commit hash). Flat organization, no projects/cycles.
 *
 * AUTH: personal API key in .triage/linear.env (gitignored; created 2026-08-05, key name
 * eq-companion-claude-agent). No secret lives in this file.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const env = readFileSync(join(import.meta.dirname, '..', '.triage', 'linear.env'), 'utf8')
const KEY = /LINEAR_API_KEY=(\S+)/.exec(env)?.[1]
if (!KEY) throw new Error('LINEAR_API_KEY missing from .triage/linear.env')

async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: KEY as string },
    body: JSON.stringify({ query, variables })
  })
  const body = (await res.json()) as { data?: T; errors?: unknown }
  if (body.errors) throw new Error(JSON.stringify(body.errors))
  return body.data as T
}

interface StateNode { id: string; name: string; type: string }
interface TeamData { teams: { nodes: { id: string; key: string; name: string; states: { nodes: StateNode[] } }[] } }

const teamData = await gql<TeamData>('query { teams { nodes { id key name states { nodes { id name type } } } } }')
const team = teamData.teams.nodes[0]
if (!team) throw new Error('no team visible to this key')

const stateId = (name: string): string => {
  const s = team.states.nodes.find((x) => x.name.toLowerCase() === name.toLowerCase())
  if (!s) throw new Error(`no state '${name}' — have: ${team.states.nodes.map((x) => x.name).join(', ')}`)
  return s.id
}

async function issueByIdentifier(ident: string): Promise<{ id: string; identifier: string; title: string }> {
  const num = Number(ident.split('-')[1])
  const d = await gql<{ issues: { nodes: { id: string; identifier: string; title: string }[] } }>(
    'query($n: Float!) { issues(filter: { number: { eq: $n } }, first: 1) { nodes { id identifier title } } }',
    { n: num }
  )
  const node = d.issues.nodes[0]
  if (!node) throw new Error(`no issue ${ident}`)
  return node
}

const [cmd, a, b] = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}

if (cmd === 'list') {
  const want = flag('state')
  const d = await gql<{ issues: { nodes: { identifier: string; title: string; state: { name: string } }[] } }>(
    'query($id: ID!) { issues(filter: { team: { id: { eq: $id } } }, first: 250, orderBy: updatedAt) { nodes { identifier title state { name } } } }',
    { id: team.id }
  )
  for (const n of d.issues.nodes) {
    if (want && n.state.name.toLowerCase() !== want.toLowerCase()) continue
    console.log(`${n.identifier}  [${n.state.name}]  ${n.title}`)
  }
} else if (cmd === 'create' && a) {
  const d = await gql<{ issueCreate: { issue: { identifier: string } } }>(
    'mutation($input: IssueCreateInput!) { issueCreate(input: $input) { issue { identifier } } }',
    { input: { teamId: team.id, title: a, description: flag('desc') ?? '', stateId: stateId(flag('state') ?? 'Backlog') } }
  )
  console.log(`created ${d.issueCreate.issue.identifier}`)
} else if (cmd === 'move' && a && b) {
  const issue = await issueByIdentifier(a)
  await gql('mutation($id: String!, $sid: String!) { issueUpdate(id: $id, input: { stateId: $sid }) { success } }', {
    id: issue.id, sid: stateId(b)
  })
  console.log(`${issue.identifier} -> ${b}`)
} else if (cmd === 'comment' && a && b) {
  const issue = await issueByIdentifier(a)
  await gql('mutation($id: String!, $body: String!) { commentCreate(input: { issueId: $id, body: $body }) { success } }', {
    id: issue.id, body: b
  })
  console.log(`${issue.identifier} commented`)
} else {
  console.log('usage: linear.mts list [--state S] | create "Title" [--state S] [--desc D] | move JOS-N "State" | comment JOS-N "text"')
}
