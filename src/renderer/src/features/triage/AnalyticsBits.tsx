// ============================================================================
// AnalyticsBits — the Analytics tab's shared primitives and its three leaf sections.
// ============================================================================
//
// Split out of `AnalyticsPanel.tsx` when the user/owner cohort split pushed that file past the
// repo's 400-code-line ceiling. The same call `usageStore.ts`, `usageRows.ts` and
// `triageAnalytics.mts` all made: a split, not a widened threshold.
//
// WHAT LIVES HERE AND WHY IT IS THIS CUT. Everything below is a pure function of the data it is
// handed — no state, no IPC, no window choice, no cohort logic. `AnalyticsPanel` keeps exactly
// the parts that make DECISIONS (which window, which cohorts, which of the three states to
// render); this file keeps the parts that only draw. The three sections here are the ones with
// no cross-section dependencies at all: Health, Versions and Retention each read one slice of
// `TriageAnalyticsData` and render it.
//
// Both files render both cohorts — there is deliberately nothing cohort-aware in here, because a
// cohort's readout is just a `TriageAnalyticsData` and the whole point of the split is that the
// owner's numbers go through the identical renderer rather than a second, drifting one.

import type { JSX, ReactNode } from 'react'
import { Box, Divider, Stack, Typography } from '@mui/material'
import type { TriageAnalyticsData, TriageMixRow, UsageDayPoint } from '@shared/triage'
import { sparklinePoints } from '@shared/perf'
import { formatNum } from '../../lib/formatRate'
import { cohortCell, pctLabel, rateLabel, seriesValues } from './analyticsRows'

const SPARK_W = 220
const SPARK_H = 28

/** Sixty numbers do not need a chart library — the PerfChip precedent, and `sparklinePoints`
 *  is a pure function a test can pin. */
export function Sparkline({ points }: { points: readonly UsageDayPoint[] }): JSX.Element {
  return (
    <Box
      component="svg"
      data-testid="analytics-sparkline"
      viewBox={`0 0 ${String(SPARK_W)} ${String(SPARK_H)}`}
      preserveAspectRatio="none"
      sx={{ width: '100%', height: SPARK_H, display: 'block' }}
    >
      <polyline
        points={sparklinePoints(seriesValues(points), SPARK_W, SPARK_H)}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
        opacity={0.75}
      />
    </Box>
  )
}

export function Section({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2">{title}</Typography>
      {children}
      <Divider />
    </Stack>
  )
}

/** `label  value  ▁▁▃▅` — the one row shape every mix list in this panel uses. */
export function MixList({
  rows,
  empty
}: {
  rows: readonly TriageMixRow[]
  empty: string
}): JSX.Element {
  if (rows.length === 0) {
    return (
      <Typography variant="caption" color="text.secondary">
        {empty}
      </Typography>
    )
  }
  const max = Math.max(...rows.map((r) => r.n))
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(120px, max-content) 1fr max-content', columnGap: 1.5, rowGap: 0.25 }}>
      {rows.map((r) => (
        <Box key={r.id} sx={{ display: 'contents' }}>
          <Typography variant="caption">{r.id}</Typography>
          <Box sx={{ alignSelf: 'center', height: 6, bgcolor: 'action.hover', borderRadius: 1 }}>
            <Box
              sx={{
                width: `${String(max > 0 ? (r.n / max) * 100 : 0)}%`,
                height: '100%',
                bgcolor: 'primary.main',
                borderRadius: 1
              }}
            />
          </Box>
          <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {formatNum(r.n)}
          </Typography>
        </Box>
      ))}
    </Box>
  )
}

export function HealthSection({ data }: { data: TriageAnalyticsData }): JSX.Element {
  const h = data.health
  return (
    <Section title="Health">
      <Typography variant="caption" color="text.secondary">
        {formatNum(h.reports)} per-session health rollups received.
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 2 }}>
        <Stack spacing={0.5}>
          <Typography variant="caption" color="text.secondary">
            Error classes
          </Typography>
          <MixList rows={h.errors} empty="No errors reported." />
        </Stack>
        <Stack spacing={0.5}>
          <Typography variant="caption" color="text.secondary">
            Update success
          </Typography>
          {h.update.map((u) => (
            <Typography key={u.step} variant="caption" sx={{ fontVariantNumeric: 'tabular-nums' }}>
              {u.step}: {rateLabel(u.rate)} ({formatNum(u.ok)} ok · {formatNum(u.failed)} failed)
            </Typography>
          ))}
          {h.updateFailures.length > 0 && (
            <Typography variant="caption" color="warning.main">
              {h.updateFailures.map((f) => `${f.id} ${String(f.n)}`).join(' · ')}
            </Typography>
          )}
        </Stack>
      </Box>
    </Section>
  )
}

export function VersionsSection({ data }: { data: TriageAnalyticsData }): JSX.Element {
  return (
    <Section title="Versions">
      {data.versions.length === 0 ? (
        <Typography variant="caption" color="text.secondary">
          No version has reported yet.
        </Typography>
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'max-content max-content max-content 1fr', columnGap: 2, rowGap: 0.25 }}>
          {data.versions.map((v) => (
            <Box key={v.version} sx={{ display: 'contents' }}>
              <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                {v.version}
              </Typography>
              <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {formatNum(v.installs)} installs
              </Typography>
              <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                peak {pctLabel(v.peakShare)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                first seen {v.firstSeenDay ?? '—'} ·{' '}
                {v.daysToAdopt === null
                  ? 'never reached a majority'
                  : `${String(v.daysToAdopt)} days to majority (${v.majorityDay ?? '—'})`}
              </Typography>
            </Box>
          ))}
        </Box>
      )}
    </Section>
  )
}

export function RetentionSection({ data }: { data: TriageAnalyticsData }): JSX.Element {
  return (
    <Section title="Retention">
      <Typography variant="caption" color="text.secondary">
        Survival, computed at read time from `analytics_install`: of the installs first seen on
        a day, how many were still being seen on or after +1 / +7 / +30. A dash means the
        cohort has not reached that horizon yet.
      </Typography>
      {data.retention.length === 0 ? (
        <Typography variant="caption" color="text.secondary">
          No cohorts yet.
        </Typography>
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(5, max-content)', columnGap: 3, rowGap: 0.25 }}>
          {['Cohort', 'Installs', 'D1', 'D7', 'D30'].map((h) => (
            <Typography key={h} variant="caption" color="text.secondary">
              {h}
            </Typography>
          ))}
          {data.retention.map((c) => (
            <Box key={c.cohortDay} sx={{ display: 'contents' }}>
              <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                {c.cohortDay}
              </Typography>
              <Typography variant="caption">{formatNum(c.installs)}</Typography>
              <Typography variant="caption">{cohortCell(c.d1, c.installs)}</Typography>
              <Typography variant="caption">{cohortCell(c.d7, c.installs)}</Typography>
              <Typography variant="caption">{cohortCell(c.d30, c.installs)}</Typography>
            </Box>
          ))}
        </Box>
      )}
    </Section>
  )
}
