/**
 * Multi-org synthetic test data generator.
 *
 * Produces realistic ExportBundle objects for 3 org types:
 * 1. Small startup (5-15 devs, fast ramp-up, high per-person commit rate)
 * 2. Mid-size company (50-150 devs, gradual AI adoption, mixed cohorts)
 * 3. Pre-AI baseline (no AI marker — the control group)
 *
 * Statistical distributions match packages/main/scripts/seed.ts patterns.
 */

import { format, subMonths, addMonths } from 'date-fns';
import type {
  ExportBundle,
  ExportMetadata,
  BeforeAfterComparison,
  BeforeAfterMetrics,
  ExecutiveSummary,
  PrTurnaroundRow,
  BotRatioRow,
} from '@shared/export-types.js';
import type {
  CohortMetricsRow,
  RampUpBucket,
  ContributorBeforeAfterStats,
  ContributorStats,
  RollingComparisonResult,
} from '@shared/types.js';
import { DEFAULT_COHORT_CONFIG } from '@shared/cohort-config.js';

// ─── Statistical distribution helpers ────────────────────────────────────────

/** Box-Muller log-normal. Returns a minimum of 1. */
function logNormal(mu: number, sigma: number): number {
  const u1 = Math.random();
  const u2 = Math.random();
  const safeU1 = Math.max(u1, 1e-10);
  const z = Math.sqrt(-2 * Math.log(safeU1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(1, Math.round(Math.exp(mu + sigma * z)));
}

/** Gaussian jitter (additive noise). */
function jitter(base: number, stdDev: number): number {
  const u1 = Math.max(Math.random(), 1e-10);
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(0, base + stdDev * z);
}

/** Weighted random choice from an array of { value, weight } pairs. */
function weightedChoice<T>(choices: Array<{ value: T; weight: number }>): T {
  const total = choices.reduce((s, c) => s + c.weight, 0);
  let r = Math.random() * total;
  for (const choice of choices) {
    r -= choice.weight;
    if (r <= 0) return choice.value;
  }
  return choices[choices.length - 1].value;
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

/** Returns the past N months as ISO month strings ('YYYY-MM'), most recent last. */
function pastMonths(count: number, referenceDate: Date = new Date()): string[] {
  const months: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    months.push(format(subMonths(referenceDate, i), 'yyyy-MM'));
  }
  return months;
}

// ─── Base ExportMetadata builder ──────────────────────────────────────────────

function buildMetadata(
  repoCount: number,
  aiMarkerDate: string | null,
  referenceDate: Date
): ExportMetadata {
  const repoNames = Array.from({ length: repoCount }, (_, i) => `org/repo-${i + 1}`);
  const startDate = format(subMonths(referenceDate, 12), "yyyy-MM-dd'T'00:00:00'Z'");
  const endDate = format(referenceDate, "yyyy-MM-dd'T'23:59:59'Z'");

  return {
    exportTimestamp: referenceDate.toISOString(),
    startDate,
    endDate,
    aiMarkerDate,
    tenureMode: 'global',
    repoIds: repoNames.map((_, i) => i + 1),
    repoNames,
    cohortConfig: DEFAULT_COHORT_CONFIG,
    toolVersion: '1.0.0',
    rollingGranularity: 'month',
  };
}

// ─── Cohort metrics builder ───────────────────────────────────────────────────

interface CohortParams {
  months: string[];
  cohorts: Array<{ key: string; contributorFraction: number }>;
  totalContributors: number;
  baseCommitSize: number;         // avgLinesAdded baseline
  aiMarkerMonth: string | null;   // e.g. '2025-06'
  aiBoost: number;                // multiplier after AI marker (e.g. 1.2)
  commitsPerContributorPerMonth: number;
}

function buildCohortMetrics(metricType: 'commits' | 'prs', params: CohortParams): CohortMetricsRow[] {
  const rows: CohortMetricsRow[] = [];

  for (const month of params.months) {
    const isAfterAI = params.aiMarkerMonth !== null && month > params.aiMarkerMonth;
    const period: 'before' | 'after' | 'all' =
      params.aiMarkerMonth === null
        ? 'all'
        : month <= params.aiMarkerMonth
        ? 'before'
        : 'after';

    const sizeMultiplier = isAfterAI ? params.aiBoost : 1.0;

    for (const cohort of params.cohorts) {
      const contributorCount = Math.max(1, Math.round(params.totalContributors * cohort.contributorFraction * jitter(1, 0.05)));
      const avgLinesAdded = Math.round(jitter(params.baseCommitSize * sizeMultiplier, params.baseCommitSize * 0.1));
      const avgLinesDeleted = Math.round(avgLinesAdded * jitter(0.5, 0.05));
      const avgFilesChanged = Math.max(1, Math.round(jitter(avgLinesAdded / 30, 0.5)));
      const totalCount = Math.round(contributorCount * params.commitsPerContributorPerMonth * jitter(1, 0.1));

      rows.push({
        cohort: cohort.key,
        period,
        periodMonth: month,
        avgLinesAdded,
        avgLinesDeleted,
        avgFilesChanged,
        totalCount,
        contributorCount,
      });
    }
  }

  return rows;
}

// ─── Ramp-up builder ──────────────────────────────────────────────────────────

interface RampUpParams {
  totalWeeks: number;           // how many weeks until full ramp (plateau)
  totalContributors: number;
  peakLinesPerWeek: number;
  referenceDate: Date;
}

function buildRampUp(params: RampUpParams): RampUpBucket[] {
  const buckets: RampUpBucket[] = [];
  const joinPeriod = format(subMonths(params.referenceDate, 6), "'Q'Q yyyy").replace(/(\d) (\d{4})/, '$2-Q$1');

  // Use a simpler join period format: YYYY-QN
  const monthsAgo = 6;
  const qDate = subMonths(params.referenceDate, monthsAgo);
  const quarter = Math.ceil((qDate.getMonth() + 1) / 3);
  const joinPeriodStr = `${qDate.getFullYear()}-Q${quarter}`;

  for (let week = 0; week < 12; week++) {
    // Ramp-up curve: starts low, plateaus at totalWeeks
    const rampFraction = week >= params.totalWeeks ? 1.0 : week / params.totalWeeks;
    const avgLinesChanged = Math.round(params.peakLinesPerWeek * rampFraction * jitter(1, 0.1));
    const avgFilesChanged = Math.max(1, Math.round(avgLinesChanged / 25));
    const contributorCount = Math.max(1, Math.round(params.totalContributors * 0.3 * jitter(1, 0.1)));
    const contributionCount = Math.round(contributorCount * 3 * jitter(1, 0.15));

    buckets.push({
      weekIndex: week,
      avgLinesChanged: Math.max(0, avgLinesChanged),
      avgFilesChanged: Math.max(1, avgFilesChanged),
      contributionCount,
      contributorCount,
      joinPeriod: joinPeriodStr,
    });
  }

  return buckets;
}

// ─── Contributors builder ─────────────────────────────────────────────────────

function buildContributors(
  count: number,
  cohortDistribution: Array<{ key: string; weight: number }>,
  aiMarkerDate: string | null
): ContributorBeforeAfterStats[] {
  const contributors: ContributorBeforeAfterStats[] = [];
  // Map to { value, weight } for weightedChoice
  const choices = cohortDistribution.map(c => ({ value: c.key, weight: c.weight }));

  for (let i = 0; i < count; i++) {
    const cohort = weightedChoice(choices);
    const firstCommitAt = new Date(Date.now() - Math.random() * 365 * 24 * 3600 * 1000 * 2).toISOString();

    const preStats: ContributorStats | null = {
      authorLogin: `user-${i}`,
      cohort,
      totalCommits: logNormal(3.5, 0.8),
      totalPrs: logNormal(2.5, 0.8),
      avgLinesAdded: logNormal(4.5, 0.7),
      avgLinesDeleted: logNormal(4.0, 0.7),
      avgFilesChanged: logNormal(1.5, 0.5),
      firstCommitAt,
    };

    let postStats: ContributorStats | null = null;
    if (aiMarkerDate !== null) {
      postStats = {
        authorLogin: `user-${i}`,
        cohort,
        totalCommits: Math.round(preStats.totalCommits * jitter(1.2, 0.1)),
        totalPrs: Math.round(preStats.totalPrs * jitter(1.15, 0.1)),
        avgLinesAdded: Math.round(preStats.avgLinesAdded * jitter(1.2, 0.1)),
        avgLinesDeleted: Math.round(preStats.avgLinesDeleted * jitter(1.1, 0.1)),
        avgFilesChanged: Math.round(preStats.avgFilesChanged * jitter(1.1, 0.1)),
        firstCommitAt,
      };
    }

    contributors.push({
      authorLogin: `user-${i}`,
      cohort,
      firstCommitAt,
      pre: preStats,
      post: postStats,
    });
  }

  return contributors;
}

// ─── PR turnaround builder ────────────────────────────────────────────────────

function buildPrTurnaround(months: string[], baseHours: number, aiMarkerMonth: string | null): PrTurnaroundRow[] {
  return months.map(month => {
    const isAfterAI = aiMarkerMonth !== null && month > aiMarkerMonth;
    const multiplier = isAfterAI ? 0.85 : 1.0;
    const avg = Math.round(jitter(baseHours * multiplier, baseHours * 0.1));
    return {
      periodMonth: month,
      avgHoursToMerge: Math.max(1, avg),
      medianHoursToMerge: Math.max(1, Math.round(avg * 0.8)),
      prCount: logNormal(3, 0.5),
    };
  });
}

// ─── Bot ratio builder ────────────────────────────────────────────────────────

function buildBotRatio(months: string[], botPct: number): BotRatioRow[] {
  return months.map(month => {
    const totalCommits = logNormal(5, 0.5);
    const botCommits = Math.round(totalCommits * jitter(botPct, 0.01));
    const humanCommits = totalCommits - botCommits;
    return {
      periodMonth: month,
      botCommits,
      humanCommits: Math.max(0, humanCommits),
      totalCommits,
      botPercentage: (botCommits / totalCommits) * 100,
    };
  });
}

// ─── Rolling comparison builder ───────────────────────────────────────────────

function buildRolling(referenceDate: Date, avgCommitSize: number): RollingComparisonResult {
  const currentStart = subMonths(referenceDate, 1);
  const priorStart = subMonths(referenceDate, 2);

  return {
    granularity: 'month',
    current: {
      label: format(currentStart, 'MMM yyyy'),
      startDate: currentStart.toISOString(),
      endDate: referenceDate.toISOString(),
      avgCommitSize: Math.round(avgCommitSize * 1.1),
      avgPrSize: Math.round(avgCommitSize * 2.5),
      commitCount: logNormal(5, 0.5),
      prCount: logNormal(4, 0.5),
      avgFilesPerCommit: logNormal(1.5, 0.3),
      avgFilesPerPr: logNormal(2.0, 0.3),
      dailyAvgCommitSize: Math.round(avgCommitSize * 1.1 / 30),
      dailyAvgPrSize: Math.round(avgCommitSize * 2.5 / 30),
      dailyCommitCount: logNormal(3, 0.5),
      dailyPrCount: logNormal(2, 0.5),
    },
    prior: {
      label: format(priorStart, 'MMM yyyy'),
      startDate: priorStart.toISOString(),
      endDate: currentStart.toISOString(),
      avgCommitSize,
      avgPrSize: Math.round(avgCommitSize * 2.3),
      commitCount: logNormal(5, 0.5),
      prCount: logNormal(4, 0.5),
      avgFilesPerCommit: logNormal(1.5, 0.3),
      avgFilesPerPr: logNormal(2.0, 0.3),
      dailyAvgCommitSize: Math.round(avgCommitSize / 30),
      dailyAvgPrSize: Math.round(avgCommitSize * 2.3 / 30),
      dailyCommitCount: logNormal(3, 0.5),
      dailyPrCount: logNormal(2, 0.5),
    },
    changes: {
      commitSize: 10,
      prSize: 8.7,
      commitFrequency: null,
      prFrequency: null,
    },
  };
}

// ─── Executive summary builder ────────────────────────────────────────────────

function buildExecutiveSummary(
  totalCommits: number,
  activeContributors: number,
  hasAiMarker: boolean
): ExecutiveSummary {
  return {
    totalCommits,
    activeContributors,
    rampUpTrend: 'Improving',
    aiAdoptionDelta: hasAiMarker ? '+18%' : null,
  };
}

// ─── Public generator functions ───────────────────────────────────────────────

/**
 * Generate a small startup ExportBundle.
 * - 8 contributors, 2 repos
 * - Fast ramp-up (full contribution by week 4)
 * - AI marker set 6 months ago
 * - High per-person commit rate
 */
export function generateSmallStartup(): ExportBundle {
  const referenceDate = new Date();
  const aiMarkerDate = format(subMonths(referenceDate, 6), 'yyyy-MM-dd');
  const aiMarkerMonth = format(subMonths(referenceDate, 6), 'yyyy-MM');
  const months = pastMonths(12, referenceDate);

  const contributorCount = 8;
  const repoCount = 2;
  const cohorts = [
    { key: 'new', contributorFraction: 0.25, weight: 0.25 },
    { key: 'mid', contributorFraction: 0.35, weight: 0.35 },
    { key: 'senior', contributorFraction: 0.40, weight: 0.40 },
  ];

  const cohortCommits = buildCohortMetrics('commits', {
    months,
    cohorts,
    totalContributors: contributorCount,
    baseCommitSize: 150,
    aiMarkerMonth,
    aiBoost: 1.2,
    commitsPerContributorPerMonth: 12,
  });

  const cohortPrs = buildCohortMetrics('prs', {
    months,
    cohorts,
    totalContributors: contributorCount,
    baseCommitSize: 300,
    aiMarkerMonth,
    aiBoost: 1.15,
    commitsPerContributorPerMonth: 4,
  });

  const rampUp = buildRampUp({
    totalWeeks: 4,
    totalContributors: contributorCount,
    peakLinesPerWeek: 180,
    referenceDate,
  });

  const contributors = buildContributors(
    contributorCount,
    cohorts.map(c => ({ key: c.key, weight: c.weight })),
    aiMarkerDate
  );

  const prTurnaround = buildPrTurnaround(months, 12, aiMarkerMonth);
  const botRatio = buildBotRatio(months, 0.05);
  const rolling = buildRolling(referenceDate, 150);

  const totalCommits = cohortCommits.reduce((s, r) => s + r.totalCount, 0);
  const executiveSummary = buildExecutiveSummary(totalCommits, contributorCount, true);

  const beforeMetrics: BeforeAfterMetrics = {
    avgCommitSize: 150,
    prFrequency: 4,
    rampUpSpeed: 4,
    activeContributors: contributorCount,
  };
  const afterMetrics: BeforeAfterMetrics = {
    avgCommitSize: 180,
    prFrequency: 5,
    rampUpSpeed: 3,
    activeContributors: contributorCount,
  };
  const beforeAfter: BeforeAfterComparison = {
    before: beforeMetrics,
    after: afterMetrics,
    markerDate: aiMarkerDate,
  };

  return {
    metadata: buildMetadata(repoCount, aiMarkerDate, referenceDate),
    cohortCommits,
    cohortPrs,
    rampUp,
    rolling,
    contributors,
    prTurnaround,
    botRatio,
    executiveSummary,
    beforeAfter,
  };
}

/**
 * Generate a mid-size company ExportBundle.
 * - 80 contributors, 15 repos
 * - Slower ramp-up (full contribution by week 8-10)
 * - AI marker set 4 months ago
 * - More gradual AI adoption curve
 */
export function generateMidSizeCompany(): ExportBundle {
  const referenceDate = new Date();
  const aiMarkerDate = format(subMonths(referenceDate, 4), 'yyyy-MM-dd');
  const aiMarkerMonth = format(subMonths(referenceDate, 4), 'yyyy-MM');
  const months = pastMonths(12, referenceDate);

  const contributorCount = 80;
  const repoCount = 15;
  const cohorts = [
    { key: 'new', contributorFraction: 0.20, weight: 0.20 },
    { key: 'mid', contributorFraction: 0.30, weight: 0.30 },
    { key: 'senior', contributorFraction: 0.50, weight: 0.50 },
  ];

  const cohortCommits = buildCohortMetrics('commits', {
    months,
    cohorts,
    totalContributors: contributorCount,
    baseCommitSize: 120,
    aiMarkerMonth,
    aiBoost: 1.1,
    commitsPerContributorPerMonth: 8,
  });

  const cohortPrs = buildCohortMetrics('prs', {
    months,
    cohorts,
    totalContributors: contributorCount,
    baseCommitSize: 250,
    aiMarkerMonth,
    aiBoost: 1.08,
    commitsPerContributorPerMonth: 3,
  });

  const rampUp = buildRampUp({
    totalWeeks: 9,
    totalContributors: contributorCount,
    peakLinesPerWeek: 140,
    referenceDate,
  });

  const contributors = buildContributors(
    contributorCount,
    cohorts.map(c => ({ key: c.key, weight: c.weight })),
    aiMarkerDate
  );

  const prTurnaround = buildPrTurnaround(months, 24, aiMarkerMonth);
  const botRatio = buildBotRatio(months, 0.15);
  const rolling = buildRolling(referenceDate, 120);

  const totalCommits = cohortCommits.reduce((s, r) => s + r.totalCount, 0);
  const executiveSummary = buildExecutiveSummary(totalCommits, contributorCount, true);

  const beforeMetrics: BeforeAfterMetrics = {
    avgCommitSize: 120,
    prFrequency: 3,
    rampUpSpeed: 9,
    activeContributors: contributorCount,
  };
  const afterMetrics: BeforeAfterMetrics = {
    avgCommitSize: 132,
    prFrequency: 3.5,
    rampUpSpeed: 7,
    activeContributors: contributorCount,
  };
  const beforeAfter: BeforeAfterComparison = {
    before: beforeMetrics,
    after: afterMetrics,
    markerDate: aiMarkerDate,
  };

  return {
    metadata: buildMetadata(repoCount, aiMarkerDate, referenceDate),
    cohortCommits,
    cohortPrs,
    rampUp,
    rolling,
    contributors,
    prTurnaround,
    botRatio,
    executiveSummary,
    beforeAfter,
  };
}

/**
 * Generate a pre-AI baseline ExportBundle (control group).
 * - 30 contributors, 8 repos
 * - NO AI marker date (CRITICAL)
 * - Flat, steady metrics with no inflection point
 * - beforeAfter is null
 */
export function generatePreAiBaseline(): ExportBundle {
  const referenceDate = new Date();
  const months = pastMonths(12, referenceDate);

  const contributorCount = 30;
  const repoCount = 8;
  const cohorts = [
    { key: 'new', contributorFraction: 0.25, weight: 0.25 },
    { key: 'mid', contributorFraction: 0.35, weight: 0.35 },
    { key: 'senior', contributorFraction: 0.40, weight: 0.40 },
  ];

  const cohortCommits = buildCohortMetrics('commits', {
    months,
    cohorts,
    totalContributors: contributorCount,
    baseCommitSize: 100,
    aiMarkerMonth: null,     // CRITICAL: no AI marker
    aiBoost: 1.0,            // no boost
    commitsPerContributorPerMonth: 6,
  });

  const cohortPrs = buildCohortMetrics('prs', {
    months,
    cohorts,
    totalContributors: contributorCount,
    baseCommitSize: 220,
    aiMarkerMonth: null,
    aiBoost: 1.0,
    commitsPerContributorPerMonth: 2,
  });

  const rampUp = buildRampUp({
    totalWeeks: 6,
    totalContributors: contributorCount,
    peakLinesPerWeek: 100,
    referenceDate,
  });

  // All contributors have null post stats (no AI marker)
  const contributors = buildContributors(contributorCount, cohorts.map(c => ({ key: c.key, weight: c.weight })), null);

  const prTurnaround = buildPrTurnaround(months, 18, null);
  const botRatio = buildBotRatio(months, 0.12);
  const rolling = buildRolling(referenceDate, 100);

  const totalCommits = cohortCommits.reduce((s, r) => s + r.totalCount, 0);
  const executiveSummary: ExecutiveSummary = {
    totalCommits,
    activeContributors: contributorCount,
    rampUpTrend: 'Stable',
    aiAdoptionDelta: null,  // CRITICAL: null because no AI marker
  };

  return {
    metadata: buildMetadata(repoCount, null, referenceDate),  // null aiMarkerDate
    cohortCommits,
    cohortPrs,
    rampUp,
    rolling,
    contributors,
    prTurnaround,
    botRatio,
    executiveSummary,
    beforeAfter: null,  // CRITICAL: null because no AI marker
  };
}

// ─── generateAllTestOrgs ──────────────────────────────────────────────────────

export interface TestOrgBundle {
  label: string;
  bundle: ExportBundle;
  sizeCategory: 'small' | 'medium' | 'large';
}

/**
 * Generate all 3 test org types.
 * Returns an array of { label, bundle, sizeCategory } for use in test imports
 * and cross-org analysis.
 */
export function generateAllTestOrgs(): TestOrgBundle[] {
  return [
    {
      label: 'Small Startup (Test)',
      bundle: generateSmallStartup(),
      sizeCategory: 'small',
    },
    {
      label: 'Mid-Size Company (Test)',
      bundle: generateMidSizeCompany(),
      sizeCategory: 'medium',
    },
    {
      label: 'Pre-AI Baseline (Control)',
      bundle: generatePreAiBaseline(),
      sizeCategory: 'medium',
    },
  ];
}
