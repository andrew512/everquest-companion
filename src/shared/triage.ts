// ============================================================================
// TRIAGE CONTRACT — the shapes the DEV-ONLY triage tab moves across IPC.
// ============================================================================
//
// This file is the seam between `src/main/triage/**` (which talks to Aurora DSQL and S3 over
// the launching shell's AWS profile) and `src/renderer/src/features/triage/**` (which renders
// what it is handed and fetches nothing itself — the renderer never reaches the network, and
// the CSP is untouched by this feature).
//
// WHY THE SHAPES LIVE HERE AND NOT IN `src/main/triage`: the renderer names every one of them
// and cannot import from `src/main` under either tsconfig. Same reasoning, same placement as
// `src/shared/feedback.ts`'s IPC-crossing block.
//
// PURE, like every other `src/shared/**` module: zero imports beyond the feedback contract's
// own type unions, no `node:`, no Electron, no DOM.
//
// THE LAW (docs/plans/feedback-triage.md §10.3) applies to everything here: a raw log slice
// never reaches anything public. `TriageSlice.lines` travels main -> renderer over IPC and is
// rendered in a local window; it is never written to a file the app publishes, never put in an
// issue body, and only ever exists in a build that has the dev flag compiled in.

import type {
  AppChannelTag,
  FeedbackType,
  ReportStatus,
  Severity
} from './feedback'

// ---- filters --------------------------------------------------------------------------

export type TriageChannelFilter = AppChannelTag | 'all'

/** Every field is re-validated AT THE HANDLER — `since` reaches `parseSince`, `limit` reaches
 *  a SQL `LIMIT`, and the two unions reach a WHERE clause. */
export interface TriageListQuery {
  channel: TriageChannelFilter
  /** `7d` / `12h` / `30m` / an ISO date — the CLI's own `--since` grammar. */
  since: string
  limit: number
  status?: ReportStatus
  type?: FeedbackType
}

/** The list's `since` choices, so the toolbar and the validator cannot disagree. */
export const TRIAGE_SINCE_CHOICES = ['24h', '7d', '30d', '90d', '365d'] as const
export const TRIAGE_LIMIT_MAX = 500
export const TRIAGE_DEFAULT_QUERY: TriageListQuery = {
  channel: 'all',
  since: '30d',
  limit: 200
}

// ---- rows -----------------------------------------------------------------------------

/**
 * Whether this report has a log slice, and whether it actually LANDED.
 *
 * TRI-STATE ON PURPOSE. `declared` means the report row carries slice metadata; whether the
 * presigned upload ever completed is a separate fact that costs one HeadObject to learn, so
 * the LIST reports `none | declared` (no per-row round trip) and the DETAIL upgrades it to
 * `present | missing`. Collapsing the two would make "the upload failed or expired" — a real
 * case the CLI prints — indistinguishable from a healthy attachment.
 */
export type TriageLogState = 'none' | 'declared' | 'present' | 'missing'

/** One row of the Reports table. The description IS the report: `title` and `contact` were
 *  retired from the wire contract and then dropped from the schema, so there is nothing here
 *  for a list to leak (the same rule `TriageReport` in scripts/triageCluster.mts obeys). */
export interface TriageRow {
  reportId: string
  type: FeedbackType
  description: string
  appVersion: string
  platform: string
  channel: AppChannelTag
  status: ReportStatus
  severity?: Severity
  cluster?: string
  spamScore: number
  receivedAt: number
  triagedAt?: number
  /** `none` or `declared` here — the list never pays for a HeadObject. */
  log: TriageLogState
}

/** The full record behind one row. There is no `contact`: the column is gone from the schema,
 *  so the detail pane has nothing extra to show and `forget` has nothing extra to clear. */
export interface TriageDetail {
  row: TriageRow
  installId: string
  clientTs: number
  /** `env_json`, parsed. TEXT-holding-JSON in the schema, so the parse is total: an
   *  unparseable blob yields `{}` rather than throwing across IPC. */
  env: Record<string, string>
  dupeOf?: string
  issueUrl?: string
  note?: string
  /** Stamped by `forget`: this report's log slice was destroyed on request. */
  redactedAt?: number
  logKey?: string
  /** From `log_json` — what the client SAID it uploaded. */
  logBytes?: number
  logLines?: number
  /** Resolved against S3: `present` or `missing` when a key exists, else `none`. */
  log: TriageLogState
}

/** The triage-only writes. Mirrors the CLI's `set` flags exactly. */
export interface TriagePatch {
  status?: ReportStatus
  severity?: Severity
  cluster?: string
  dupeOf?: string
  note?: string
}

// ---- the log slice --------------------------------------------------------------------

/**
 * A downloaded, gunzipped slice, CAPPED for the bridge. The bytes are fetched in main, cached
 * under `.triage/slices/` (gitignored twice over) and only `lines` crosses IPC — the same
 * discipline `feedback:buildSlice` uses for the outbound preview, and for the same reason: a
 * multi-megabyte string does not belong on the bridge.
 */
export interface TriageSlice {
  reportId: string
  lines: string[]
  /** True when the slice holds more than `lines` shows — `totalLines` is the real count. */
  truncated: boolean
  totalLines: number
  /** Where the cached copy lives on this machine. Local, gitignored, never published. */
  path: string
  /**
   * THE RE-SCRUB DELTA (src/main/triage/store.ts `downloadSlice`). The presign policy pins an
   * upload's key, size and type — it cannot pin its CONTENT, so the downloaded bytes are run
   * through the SHARED scrubber and the SHARED text sanitizer before they reach the owner's
   * disk. These two counts are what that pass removed:
   *
   *   * `rescrubDropped` — third-party chat/social lines. Zero for an honest client, because an
   *     honest client already ran the identical module. Non-zero is EVIDENCE that the
   *     client-side scrub was skipped or bypassed, and the UI says so out loud.
   *   * `rescrubCleaned` — lines that carried control characters or ANSI escape sequences.
   *
   * `rescrubUnknown` marks a copy cached BEFORE this pass existed: its counts were never
   * recorded, and claiming zeros for it would be asserting something we did not measure.
   */
  rescrubDropped: number
  rescrubCleaned: number
  rescrubUnknown: boolean
}

// ---- ops ------------------------------------------------------------------------------

/**
 * The kill switch, stated POSITIVELY.
 *
 * The CLI spells this as `closed on|off`, which is a double negative once it reaches
 * `setAccepting(state === 'off')`. The UI owns one polarity — `accepting` — and its label says
 * so, because an inverted kill switch is the single worst bug this panel could ship.
 */
export interface TriageOpsState {
  accepting: boolean
  closedMessage: string
  maxPerInstallPerDay: number
  blocked: TriageBlockedInstall[]
}

export interface TriageBlockedInstall {
  installId: string
  blocked: boolean
  reason?: string
  blockedAt?: number
}

// ---- digest ---------------------------------------------------------------------------

/** Structurally identical to `Cluster` in scripts/triageCluster.mts, restated here because the
 *  renderer cannot import from `scripts/` under tsconfig.web. Main passes those values through. */
export interface TriageClusterView {
  id: string
  kind: 'crash' | 'tokens'
  signature?: string
  reportIds: string[]
  types: FeedbackType[]
  versions: string[]
  regression: boolean
  withLogs: number
  label: string
}

export interface TriageDigest {
  /** Exactly what `triage-feedback digest` prints — the same `renderDigest` call. */
  markdown: string
  clusters: TriageClusterView[]
  reportCount: number
}

// ---- analytics (usage telemetry — docs/plans/usage-analytics.md A3) ---------------------
//
// THE SHAPE IS WHAT THE TABLES CAN ACTUALLY ANSWER, and nothing more. Every field below is
// derivable from `usage_daily` + `usage_funnel_daily` + `analytics_install`; the numbers the
// plan asked for that are NOT derivable from anonymous daily counters are absent rather than
// approximated silently:
//
//   * per-feature REACH % (share of installs that used a feature) would need per-id,
//     per-feature state — the per-user trail T6 refuses to keep. `uses` and `perSession` are
//     what the counters can say, and the panel labels them as such.
//   * MEDIAN session length is a BUCKET RANGE (`medianSessionLabel`), because a median cannot
//     be summed across days; the ingest path keeps a histogram precisely so this is answerable
//     at all, and it is answerable to a bucket, not to a millisecond.
//   * RETENTION is survival: "first seen on day D and still seen on or after D+N", read off
//     `analytics_install`. It is not "came back ON day D+N" — no per-day-per-id row exists.
//
// `available: false` means exactly ONE class of thing: this cluster does not have what this
// code reads — a table the A2 migration creates, or the `cohort` column the user/owner split
// added. Tables that exist and are EMPTY render as honest zeros with a "no data yet" note — an
// empty stack is a real, informative state and hiding it behind the same arm as "not deployed"
// would make the two indistinguishable.
//
// THE USER/OWNER SPLIT IS AT THIS LEVEL, not inside `TriageAnalyticsData`. `data` is ALWAYS the
// user cohort — the population question, which is what the panel and the digest are for — and
// `owner` is a SECOND, COMPLETE readout rendered beside it when asked for. Two values rather
// than a cohort field on every row, because that shape makes summing them require writing code
// that adds two `TriageAnalyticsData`s together, which nobody will ever accidentally do.

/** One point of a daily series. `day` is the UTC `yyyy-mm-dd` key the counters are stored on. */
export interface UsageDayPoint {
  day: string
  n: number
}

export interface TriageAnalyticsPulse {
  /** Installs seen on the most recent day IN THE WINDOW that has any data. */
  dau: number
  /** Distinct installs whose `last_seen_day` is within 7 / 30 days of that day. */
  wau: number
  mau: number
  /** Every `analytics_install` row — the all-time footprint, not a window. */
  installsTotal: number
  /**
   * TODAY, in UTC, and today is the CLOCK's day rather than the window's last day with data —
   * unlike DAU beside it, which anchors on the last day anything arrived. "Installs today" that
   * silently meant "installs on the last day we heard anything" would read as a live number and
   * be a stale one; a true zero is the honest answer to a quiet morning.
   */
  installsToday: number
  /** Installs that reported a different build than they were last on, today. Server-derived. */
  upgradesToday: number
  /**
   * Log lines this fleet parsed IN THE WINDOW. Counts parsing work, not distinct lines: the
   * startup replay re-reads a character's history every launch and TELEMETRY.md says so.
   */
  linesParsed: number
  sessions: number
  sessionsPerDay: number
  /** From the `sessionMsTotal` / `sessionEnds` pair. Null when no session has ended yet. */
  meanSessionMs: number | null
  /** A RANGE (`15 min–30 min`), never a fake exact number. Null when the histogram is empty. */
  medianSessionLabel: string | null
  activeSeries: UsageDayPoint[]
  sessionSeries: UsageDayPoint[]
}

export interface TriageFeatureRow {
  id: string
  uses: number
  /** Uses per session in the window — the honest stand-in for reach. */
  perSession: number
}

export interface TriageViewRow {
  id: string
  dwellMs: number
  visits: number
  /** This view's share of all dwell time, 0..1. */
  share: number
}

export interface TriageMixRow {
  id: string
  n: number
}

export interface TriageAnalyticsAdoption {
  features: TriageFeatureRow[]
  views: TriageViewRow[]
  /** Overlay opens by kind, voice-engine mix and cursor-ring/auto-hide from setupSnapshot. */
  overlays: TriageMixRow[]
  voice: TriageMixRow[]
  cursorRing: TriageMixRow[]
  autoHide: TriageMixRow[]
  alertsFired: number
  alertsSpoken: number
}

export interface TriageFunnelStepRow {
  step: string
  n: number
  /** Share of the FIRST step that reached this one, 0..1. */
  conversion: number
  /** Share of the PREVIOUS step lost here, 0..1. */
  dropOff: number
}

export interface TriageFunnelView {
  funnel: string
  steps: TriageFunnelStepRow[]
  /** The same curve per app version — where a regression shows up as a changed drop-off. */
  byVersion: { version: string; steps: TriageFunnelStepRow[] }[]
  /** `<step>:<failureClass>` counts, from `usage_daily`. */
  failures: TriageMixRow[]
}

export interface TriageUpdateRow {
  step: string
  ok: number
  failed: number
  /** ok / (ok + failed), or null when the step was never reported. */
  rate: number | null
}

export interface TriageAnalyticsHealth {
  /** Per error class, from `healthCounters`. */
  errors: TriageMixRow[]
  /** How many per-session health rollups arrived — the denominator for the row above. */
  reports: number
  update: TriageUpdateRow[]
  updateFailures: TriageMixRow[]
}

export interface TriageVersionRow {
  version: string
  /** Installs currently ON this version (`analytics_install.app_version`). */
  installs: number
  /** Peak share of daily active installs this version reached, 0..1. */
  peakShare: number
  firstSeenDay: string | null
  /** The first day this version was more than half of that day's active installs. */
  majorityDay: string | null
  /** firstSeenDay → majorityDay, in days. Null while it has never reached a majority. */
  daysToAdopt: number | null
}

/**
 * ONE PUBLISHED RELEASE'S DOWNLOAD COUNTS, read off the public GitHub releases API.
 *
 * IT IS NOT AN INSTALL COUNT, and every label that renders it says so. The auto-updater fetches
 * the installer asset again on every install it updates, so `download_count` is dominated by the
 * fleet updating ITSELF — v0.5.0 took 61 downloads within hours of publication, from a fleet
 * nowhere near that size. `analytics_install` (the readout's "installs all-time") is the install
 * truth; this is a fetch count that happens to be public.
 */
export interface TriageDownloadRow {
  /** The release tag, e.g. `v0.5.0`. */
  tag: string
  /** The `.exe` installer asset(s) only — latest.yml and .blockmap fetches are excluded. */
  exeDownloads: number
  /** Every asset on the release, installer and update metadata alike. */
  totalDownloads: number
  /** ISO timestamp, or null for a release GitHub reported without one. */
  publishedAt: string | null
}

/**
 * GitHub's answer, or why there is not one. UNAVAILABLE IS A QUIET STATE, NEVER AN ERROR: the
 * readout is a view over the cluster, and an unreachable github.com or a spent rate limit must
 * not take it down with it — the section says the reason and everything else renders as usual.
 */
export type TriageDownloads =
  | { available: true; releases: TriageDownloadRow[]; fetchedAtMs: number }
  | { available: false; reason: string }

/**
 * WHO IS IN THE APP RIGHT NOW — the one number in this whole readout that does not come from the
 * counter tables, because they cannot answer it: `usage_daily` is keyed on a DAY, and "right now"
 * is not a day.
 *
 * ITS SOURCE IS THE CloudWatch EMF METRIC `EQCompanion/Telemetry · Heartbeats` (Channel=prod),
 * which the ingest Lambda emits per accepted batch. One heartbeat per open session per five
 * minutes, so the Sum over a 300-second period IS the number of sessions that were alive in it.
 * Deliberately channel-split rather than cohort-split (a CloudWatch metric's identity is its
 * dimension set; adding Cohort would orphan every dashboard widget).
 *
 * THE AGE IS AN ESTIMATE AND IS LABELLED ONE, everywhere it is rendered. Nothing anywhere knows
 * when an individual session started — that would need the per-id, per-session trail this design
 * refuses to keep — so it is derived from how far back the heartbeat count has been sustained:
 * a session alive for N buckets contributes a heartbeat to each of them, so the number of
 * sessions alive now that were ALSO alive j buckets ago is at most `min(now, then)`, and summing
 * that over j gives a mean age in buckets. It is a FLOOR whenever the lookback window is fully
 * occupied (`ageIsFloor`), because a session older than the window is only counted as far back as
 * the window reaches.
 */
export type TriageLiveSessions =
  | {
      available: true
      /** Sessions alive in the last COMPLETE 5-minute bucket. Zero is a real answer. */
      activeNow: number
      /** End of that bucket, ms — what "now" actually means in this number. */
      asOfMs: number
      /** ESTIMATED mean age of those sessions, ms. Null when nothing is alive to have an age. */
      avgAgeMs: number | null
      /** The estimate hit the end of the lookback: `avgAgeMs` is a floor, not a mean. */
      ageIsFloor: boolean
      /** How far back the derivation could see. */
      lookbackMs: number
    }
  | { available: false; reason: string }

export interface TriageCohortRow {
  cohortDay: string
  installs: number
  /** Still seen on or after cohortDay + N. Null while the cohort is younger than N days. */
  d1: number | null
  d7: number | null
  d30: number | null
}

export interface TriageAnalyticsData {
  windowDays: number
  /** The day keys the window covers, ascending — the x-axis every series is aligned to. */
  days: string[]
  /** True when every table exists and none of them had a row in the window. */
  empty: boolean
  pulse: TriageAnalyticsPulse
  adoption: TriageAnalyticsAdoption
  funnels: TriageFunnelView[]
  health: TriageAnalyticsHealth
  versions: TriageVersionRow[]
  retention: TriageCohortRow[]
}

/** The window choices, so the toolbar and the handler validator cannot disagree. */
export const TRIAGE_ANALYTICS_DAYS = [7, 30, 90, 365] as const
export const TRIAGE_ANALYTICS_DEFAULT_DAYS = 30

export type TriageAnalytics =
  /**
   * NOT AVAILABLE, AND WHICH KIND — `state` names it, the same way `TriageLogState` names the
   * four things a slice can be. Two genuinely different facts, and the panel says different
   * words for each:
   *   * `missing` — the cluster answered, and does not have a table or column this code reads.
   *     `missing` names it. One `migrate` fixes it.
   *   * `unreachable` — the cluster did not answer at all: the socket dropped mid-read
   *     (`store.ts unreachable()`). Nothing is wrong with the schema and nothing needs
   *     migrating; the next attempt opens a fresh connection. Before this state existed the
   *     panel printed node-postgres's raw `Connection terminated unexpectedly` at the owner —
   *     and the async half of the same failure was an uncaughtException in the main process.
   */
  | { available: false; state: 'missing'; reason: string; missing: string }
  | { available: false; state: 'unreachable'; reason: string }
  | {
      available: true
      /** The USER cohort — the owner's own use is not in here. Always present. */
      data: TriageAnalyticsData
      /** The OWNER cohort, as its own complete readout. Null unless it was asked for. */
      owner: TriageAnalyticsData | null
      /** Is there any owner data at all in the window? Decides whether the toggle is offered. */
      ownerPresent: boolean
      /**
       * GITHUB RELEASE DOWNLOADS, MERGED IN AT THE IPC EDGE (`src/main/triage/ipc.ts`) and
       * nowhere else. `buildAnalytics` is pure over the three counter tables and NEVER populates
       * this; the field is optional precisely so that stays true — an answer built without ever
       * touching the network is a legal `TriageAnalytics`.
       *
       * It sits beside `data`/`owner` rather than inside `TriageAnalyticsData` because a
       * releases page knows nothing about who downloaded: downloads are GLOBAL and are rendered
       * once, never split or summed per cohort.
       */
      downloads?: TriageDownloads
      /**
       * LIVE SESSIONS, merged at the same edge and for the same reason: it is a CloudWatch read,
       * not a counter row, and `buildAnalytics` stays pure over the three tables.
       *
       * It is likewise GLOBAL rather than per cohort — the EMF metric is split by channel, never
       * by cohort (`TriageLiveSessions` says why) — so it is rendered once, above both readouts.
       */
      live?: TriageLiveSessions
    }

// ---- the reply envelope ----------------------------------------------------------------

/**
 * EVERY triage channel answers with one of these instead of rejecting.
 *
 * The failure mode this exists for is not a bug, it is the ACCESS CONTROL working: a shell
 * without the owner's AWS credentials gets an IAM denial from DSQL or S3 on the very first
 * statement. That has to render as prose in the panel, not as an unhandled rejection in a
 * renderer that then shows a blank tab.
 */
export type TriageResult<T> = { ok: true; value: T } | { ok: false; error: string }
