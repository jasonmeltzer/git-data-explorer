/**
 * Client-side insight computation functions for each dashboard section.
 * All functions are pure — they accept raw API response data and return
 * StatInsight arrays ready for StatCalloutRow/StatCalloutBox.
 *
 * D-06: computed client-side from API response data, no LLM.
 */

import type { CohortMetricsRow, RollingComparisonResult, RampUpBucket } from '@shared/types.js';
import { COHORT_LABELS } from '@shared/cohort-config.js';

export interface StatInsight {
  label: string;
  value: string;
  delta?: string;
  deltaDir?: 'up' | 'down' | 'neutral';
}

/**
 * Format a percentage change number as a signed string with %.
 * e.g. 12.3 -> "+12%", -5.7 -> "-6%"
 */
function formatPct(value: number): string {
  const rounded = Math.round(value);
  return rounded >= 0 ? `+${rounded}%` : `${rounded}%`;
}

/**
 * Determine direction from a signed percentage change.
 */
function pctDir(value: number): 'up' | 'down' | 'neutral' {
  if (value > 0) return 'up';
  if (value < 0) return 'down';
  return 'neutral';
}

/**
 * Format hours as "Xh" if < 24h, or "X.Xd" if >= 24h.
 */
function formatHours(hours: number): string {
  if (hours < 24) {
    return `${Math.round(hours)}h`;
  }
  return `${(hours / 24).toFixed(1)}d`;
}

// ---------------------------------------------------------------------------
// computeCohortInsights
// ---------------------------------------------------------------------------

/**
 * Returns 3 stat insights for a cohort metrics dataset (PR or Commit sections).
 *
 * 1. "Avg [PR|Commit] Size" — average of the metric across all cohorts in the latest month
 * 2. "Peak Cohort" — which cohort has the highest avg value in the latest month
 * 3. "MoM Change" — % change from second-to-last month to latest month
 */
export function computeCohortInsights(
  rows: CohortMetricsRow[],
  metric: 'avgLinesAdded' | 'avgLinesDeleted' | 'avgFilesChanged' | 'totalCount',
  type: 'pr' | 'commit'
): StatInsight[] {
  const label = type === 'pr' ? 'PR' : 'Commit';

  if (!rows || rows.length === 0) {
    return [
      { label: `Avg ${label} Size`, value: '--' },
      { label: 'Peak Cohort', value: '--' },
      { label: 'MoM Change', value: '--' },
    ];
  }

  const months = [...new Set(rows.map(r => r.periodMonth))].sort();
  const latestMonth = months[months.length - 1];
  const priorMonth = months.length >= 2 ? months[months.length - 2] : null;

  const latestRows = rows.filter(r => r.periodMonth === latestMonth);

  // 1. Average across all cohorts in the latest month
  const latestValues = latestRows.map(r => r[metric] as number).filter(v => v > 0);
  const avgValue = latestValues.length > 0
    ? latestValues.reduce((a, b) => a + b, 0) / latestValues.length
    : 0;

  const metricLabel = metric === 'avgFilesChanged' ? 'Avg Files' : `Avg ${label} Size`;

  const avgValueStr = metric === 'totalCount'
    ? Math.round(avgValue).toLocaleString()
    : metric === 'avgFilesChanged'
      ? avgValue.toFixed(1)
      : Math.round(avgValue).toLocaleString();

  // 2. Peak cohort in latest month
  let peakCohort = '--';
  let peakValue = -Infinity;
  for (const row of latestRows) {
    const v = row[metric] as number;
    if (v > peakValue) {
      peakValue = v;
      peakCohort = COHORT_LABELS[row.cohort] ?? row.cohort;
    }
  }

  // 3. MoM Change — compare total of metric across all cohorts between two months
  let momInsight: StatInsight = { label: 'MoM Change', value: '--' };
  if (priorMonth) {
    const priorRows = rows.filter(r => r.periodMonth === priorMonth);
    const priorValues = priorRows.map(r => r[metric] as number).filter(v => v > 0);
    const priorAvg = priorValues.length > 0
      ? priorValues.reduce((a, b) => a + b, 0) / priorValues.length
      : 0;

    if (priorAvg !== 0) {
      const pct = ((avgValue - priorAvg) / priorAvg) * 100;
      momInsight = {
        label: 'MoM Change',
        value: formatPct(pct),
        delta: formatPct(pct),
        deltaDir: pctDir(pct),
      };
    }
  }

  return [
    { label: metricLabel, value: avgValue === 0 ? '--' : avgValueStr },
    { label: 'Peak Cohort', value: peakCohort },
    momInsight,
  ];
}

// ---------------------------------------------------------------------------
// computeRampUpInsights
// ---------------------------------------------------------------------------

/**
 * Returns 2-3 stat insights for the ramp-up chart.
 *
 * 1. "Fastest Cohort" — join period with steepest early slope (weeks 1-4)
 * 2. "Weeks to 100 Lines" — median weeks across join periods to reach 100 avg lines
 * 3. "Post-AI Improvement" — if AI marker set, % faster post-AI vs pre-AI (else omit)
 */
export function computeRampUpInsights(
  data: RampUpBucket[],
  hasAiMarker: boolean
): StatInsight[] {
  if (!data || data.length === 0) {
    const base: StatInsight[] = [
      { label: 'Fastest Cohort', value: '--' },
      { label: 'Weeks to 100 Lines', value: '--' },
    ];
    if (hasAiMarker) {
      base.push({ label: 'Post-AI Improvement', value: '--' });
    }
    return base;
  }

  const joinPeriods = [...new Set(data.map(b => b.joinPeriod))];

  // 1. Fastest cohort — steepest slope over weeks 0-3 (first 4 buckets)
  let fastestPeriod = '--';
  let fastestSlope = -Infinity;

  for (const period of joinPeriods) {
    const periodBuckets = data
      .filter(b => b.joinPeriod === period && b.weekIndex <= 3)
      .sort((a, b) => a.weekIndex - b.weekIndex);

    if (periodBuckets.length < 2) continue;
    const first = periodBuckets[0].avgLinesChanged;
    const last = periodBuckets[periodBuckets.length - 1].avgLinesChanged;
    const slope = (last - first) / periodBuckets.length;
    if (slope > fastestSlope) {
      fastestSlope = slope;
      fastestPeriod = period;
    }
  }

  // 2. Median weeks to reach 100 avg lines across join periods
  const weeksPerPeriod: number[] = [];
  for (const period of joinPeriods) {
    const periodBuckets = data
      .filter(b => b.joinPeriod === period)
      .sort((a, b) => a.weekIndex - b.weekIndex);

    const crossingBucket = periodBuckets.find(b => b.avgLinesChanged >= 100);
    if (crossingBucket) {
      weeksPerPeriod.push(crossingBucket.weekIndex + 1); // 1-indexed
    }
  }

  let medianWeeks = '--';
  if (weeksPerPeriod.length > 0) {
    const sorted = [...weeksPerPeriod].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 !== 0
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
    medianWeeks = `${Math.round(median)}`;
  }

  const result: StatInsight[] = [
    { label: 'Fastest Cohort', value: fastestPeriod },
    { label: 'Weeks to 100 Lines', value: medianWeeks === '--' ? '--' : `${medianWeeks}wk` },
  ];

  // 3. Post-AI improvement — only if AI marker set
  if (hasAiMarker && joinPeriods.length >= 2) {
    const sortedPeriods = [...joinPeriods].sort();
    const midIdx = Math.floor(sortedPeriods.length / 2);
    const preAiPeriods = sortedPeriods.slice(0, midIdx);
    const postAiPeriods = sortedPeriods.slice(midIdx);

    const avgWeeks = (periods: string[]) => {
      const weeks: number[] = [];
      for (const period of periods) {
        const periodBuckets = data
          .filter(b => b.joinPeriod === period)
          .sort((a, b) => a.weekIndex - b.weekIndex);
        const crossingBucket = periodBuckets.find(b => b.avgLinesChanged >= 100);
        if (crossingBucket) weeks.push(crossingBucket.weekIndex + 1);
      }
      return weeks.length > 0 ? weeks.reduce((a, b) => a + b, 0) / weeks.length : null;
    };

    const preAvg = avgWeeks(preAiPeriods);
    const postAvg = avgWeeks(postAiPeriods);

    if (preAvg !== null && postAvg !== null && preAvg !== 0) {
      const pct = ((preAvg - postAvg) / preAvg) * 100; // positive = faster
      result.push({
        label: 'Post-AI Improvement',
        value: formatPct(pct),
        delta: formatPct(pct),
        deltaDir: pct > 0 ? 'up' : pct < 0 ? 'down' : 'neutral',
      });
    } else {
      result.push({ label: 'Post-AI Improvement', value: '--' });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// computeRollingInsights
// ---------------------------------------------------------------------------

/**
 * Returns 3 stat insights for rolling comparison data.
 *
 * 1. "MoM Change" (commits) from data.changes.commitSize
 * 2. "QoQ Change" (PRs) from data.changes.prSize
 * 3. "Trend Direction" — dominant signal across all changes
 */
export function computeRollingInsights(
  data: RollingComparisonResult | undefined
): StatInsight[] {
  if (!data) {
    return [
      { label: 'MoM Change', value: '--' },
      { label: 'QoQ Change', value: '--' },
      { label: 'Trend Direction', value: '--' },
    ];
  }

  const commitChange = data.changes.commitSize;
  const prChange = data.changes.prSize;

  const commitInsight: StatInsight =
    commitChange !== null
      ? {
          label: 'MoM Change',
          value: formatPct(commitChange),
          delta: formatPct(commitChange),
          deltaDir: pctDir(commitChange),
        }
      : { label: 'MoM Change', value: '--' };

  const prInsight: StatInsight =
    prChange !== null
      ? {
          label: 'QoQ Change',
          value: formatPct(prChange),
          delta: formatPct(prChange),
          deltaDir: pctDir(prChange),
        }
      : { label: 'QoQ Change', value: '--' };

  // Dominant signal — count ups vs downs
  const signals = [commitChange, prChange, data.changes.commitFrequency, data.changes.prFrequency]
    .filter((v): v is number => v !== null);

  let trendValue = '--';
  let trendDir: 'up' | 'down' | 'neutral' = 'neutral';
  if (signals.length > 0) {
    const ups = signals.filter(v => v > 0).length;
    const downs = signals.filter(v => v < 0).length;
    if (ups > downs) {
      trendValue = 'Increasing';
      trendDir = 'up';
    } else if (downs > ups) {
      trendValue = 'Decreasing';
      trendDir = 'down';
    } else {
      trendValue = 'Stable';
      trendDir = 'neutral';
    }
  }

  return [
    commitInsight,
    prInsight,
    { label: 'Trend Direction', value: trendValue, deltaDir: trendDir },
  ];
}

// ---------------------------------------------------------------------------
// computePrTurnaroundInsights
// ---------------------------------------------------------------------------

/**
 * Returns 3 stat insights for PR turnaround data.
 *
 * 1. "Median Time to Merge" — latest month's avg hours, formatted as "Xh" or "X.Xd"
 * 2. "Fastest Month" — month with lowest avg hours to merge
 * 3. "Trend" — improving/worsening/stable comparing first half to second half
 */
export function computePrTurnaroundInsights(
  data: Array<{ periodMonth: string; avgHoursToMerge: number; prCount: number }>
): StatInsight[] {
  if (!data || data.length === 0) {
    return [
      { label: 'Median Time to Merge', value: '--' },
      { label: 'Fastest Month', value: '--' },
      { label: 'Trend', value: '--' },
    ];
  }

  const sorted = [...data].sort((a, b) => a.periodMonth.localeCompare(b.periodMonth));

  // 1. Latest month's avg hours
  const latest = sorted[sorted.length - 1];
  const mergeTime = formatHours(latest.avgHoursToMerge);

  // 2. Fastest month
  const fastest = [...data].reduce((min, d) =>
    d.avgHoursToMerge < min.avgHoursToMerge ? d : min
  );

  // 3. Trend — compare first half to second half averages
  let trendValue = '--';
  let trendDir: 'up' | 'down' | 'neutral' = 'neutral';
  if (sorted.length >= 2) {
    const mid = Math.floor(sorted.length / 2);
    const firstHalf = sorted.slice(0, mid);
    const secondHalf = sorted.slice(mid);
    const avgFirst = firstHalf.reduce((s, d) => s + d.avgHoursToMerge, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((s, d) => s + d.avgHoursToMerge, 0) / secondHalf.length;
    const pct = ((avgSecond - avgFirst) / avgFirst) * 100;
    if (Math.abs(pct) < 5) {
      trendValue = 'Stable';
      trendDir = 'neutral';
    } else if (pct < 0) {
      // Decreasing hours = improving
      trendValue = `Improving ${Math.abs(Math.round(pct))}%`;
      trendDir = 'up';
    } else {
      trendValue = `Worsening ${Math.round(pct)}%`;
      trendDir = 'down';
    }
  }

  return [
    { label: 'Median Time to Merge', value: mergeTime },
    { label: 'Fastest Month', value: fastest.periodMonth },
    { label: 'Trend', value: trendValue, deltaDir: trendDir },
  ];
}

// ---------------------------------------------------------------------------
// computeBotRatioInsights
// ---------------------------------------------------------------------------

/**
 * Returns 3 stat insights for bot ratio data.
 *
 * 1. "Current Bot Share" — latest month's percentage, e.g. "12%"
 * 2. "Peak Bot Month" — month with highest bot percentage
 * 3. "Trend" — rising/falling/stable
 */
export function computeBotRatioInsights(
  data: Array<{ periodMonth: string; botPercentage: number }>
): StatInsight[] {
  if (!data || data.length === 0) {
    return [
      { label: 'Current Bot Share', value: '--' },
      { label: 'Peak Bot Month', value: '--' },
      { label: 'Trend', value: '--' },
    ];
  }

  const sorted = [...data].sort((a, b) => a.periodMonth.localeCompare(b.periodMonth));

  // 1. Latest month's bot percentage
  const latest = sorted[sorted.length - 1];
  const currentShare = `${Math.round(latest.botPercentage)}%`;

  // 2. Peak bot month
  const peak = [...data].reduce((max, d) =>
    d.botPercentage > max.botPercentage ? d : max
  );

  // 3. Trend — compare first vs last period
  let trendValue = '--';
  let trendDir: 'up' | 'down' | 'neutral' = 'neutral';
  if (sorted.length >= 2) {
    const first = sorted[0].botPercentage;
    const last = sorted[sorted.length - 1].botPercentage;
    const diff = last - first;
    if (Math.abs(diff) < 1) {
      trendValue = 'Stable';
      trendDir = 'neutral';
    } else if (diff > 0) {
      trendValue = 'Rising';
      trendDir = 'up';
    } else {
      trendValue = 'Falling';
      trendDir = 'down';
    }
  }

  return [
    { label: 'Current Bot Share', value: currentShare },
    { label: 'Peak Bot Month', value: peak.periodMonth },
    { label: 'Trend', value: trendValue, deltaDir: trendDir },
  ];
}

// ---------------------------------------------------------------------------
// computeExecutiveSummaryInsights
// ---------------------------------------------------------------------------

/**
 * Returns 4 stat insights for the executive summary section (D-07).
 *
 * 1. "Total Commits" — formatted with commas
 * 2. "Active Contributors" — integer
 * 3. "Ramp-Up Trend" — rampUpTrend value or prompt to set AI marker date
 * 4. "AI Adoption Delta" — aiAdoptionDelta value or prompt to set AI marker date
 */
export function computeExecutiveSummaryInsights(
  summary: {
    totalCommits: number;
    activeContributors: number;
    rampUpTrend: string | null;
    aiAdoptionDelta: string | null;
  }
): StatInsight[] {
  return [
    {
      label: 'Total Commits',
      value: summary.totalCommits.toLocaleString(),
    },
    {
      label: 'Active Contributors',
      value: summary.activeContributors.toLocaleString(),
    },
    {
      label: 'Ramp-Up Trend',
      value: summary.rampUpTrend ?? 'Set AI marker date in Settings',
    },
    {
      label: 'AI Adoption Delta',
      value: summary.aiAdoptionDelta ?? 'Set AI marker date in Settings',
    },
  ];
}
