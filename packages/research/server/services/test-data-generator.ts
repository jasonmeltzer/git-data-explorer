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
  ExecutiveSummary,
  PrTurnaroundRow,
  BotRatioRow,
  PeriodMetric,
  ConcentrationMonthlyRow,
  HeadcountMonthlyRow,
} from '@shared/export-types.js';
import type {
  CohortMetricsRow,
  RampUpBucket,
  ContributorBeforeAfterStats,
  ContributorStats,
  RollingComparisonResult,
} from '@shared/types.js';
import { DEFAULT_COHORT_CONFIG } from '@shared/cohort-config.js';
import { buildPeriodsFromMarker } from '@shared/lib/periods.js';

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

// ─── Activity profile: single source of truth for a generated org ─────────
interface SyntheticPersona {
  login: string;
  cohort: 'new' | 'mid' | 'senior';
  commitsPerMonth: number;
  linesPerCommit: number;
  prsPerMonth: number;
  aiBoostFactor: number;  // 1.0 = no effect; 1.2 = 20% boost when in post-AI month
}

interface ActivityProfile {
  personas: SyntheticPersona[];
  months: string[];
  aiMarkerMonth: string | null;
  monthlyCommitsByPersona: Array<Map<string, number>>;
  monthlyLinesByPersona:   Array<Map<string, number>>;
  monthlyPrsByPersona:     Array<Map<string, number>>;
}

interface BuildActivityProfileParams {
  contributorCount: number;
  months: string[];
  aiMarkerMonth: string | null;
  cohorts: Array<{ key: 'new' | 'mid' | 'senior'; weight: number }>;
  baseCommitsPerMonth: number;      // center of distribution for per-persona commits
  baseLinesPerCommit: number;
  basePrsPerMonth: number;
  aiBoostMean: number;              // mean of aiBoostFactor across personas (e.g. 1.2)
  dominantWindow?: { startIdx: number; endIdx: number; topShare: number }; // indices into months array
  headcountSchedule?: Array<{ monthIdx: number; delta: number }>; // D-09: preserves team-size step (delta < 0 = departures)
}

function buildActivityProfile(p: BuildActivityProfileParams): ActivityProfile {
  // 1. Generate personas
  const personas: SyntheticPersona[] = [];
  const cohortChoices = p.cohorts.map(c => ({ value: c.key, weight: c.weight }));
  for (let i = 0; i < p.contributorCount; i++) {
    const cohort = weightedChoice(cohortChoices);
    personas.push({
      login: animalName(i),
      cohort,
      commitsPerMonth: Math.max(1, Math.round(jitter(p.baseCommitsPerMonth, p.baseCommitsPerMonth * 0.3))),
      linesPerCommit: Math.max(10, Math.round(logNormal(Math.log(p.baseLinesPerCommit), 0.4))),
      prsPerMonth: Math.max(0.5, jitter(p.basePrsPerMonth, p.basePrsPerMonth * 0.25)),
      aiBoostFactor: jitter(p.aiBoostMean, 0.05),
    });
  }

  // 2. Compute monthly activity per persona
  const monthlyCommitsByPersona = p.months.map(() => new Map<string, number>());
  const monthlyLinesByPersona   = p.months.map(() => new Map<string, number>());
  const monthlyPrsByPersona     = p.months.map(() => new Map<string, number>());

  for (let mi = 0; mi < p.months.length; mi++) {
    const month = p.months[mi];
    const isPostAI = p.aiMarkerMonth !== null && month > p.aiMarkerMonth;

    for (const persona of personas) {
      const boost = isPostAI ? persona.aiBoostFactor : 1.0;
      const commits = Math.max(0, Math.round(persona.commitsPerMonth * boost * jitter(1, 0.1)));
      const lines = commits * Math.max(10, Math.round(persona.linesPerCommit * jitter(1, 0.1)));
      const prs = Math.max(0, persona.prsPerMonth * boost * jitter(1, 0.1));

      monthlyCommitsByPersona[mi].set(persona.login, commits);
      monthlyLinesByPersona[mi].set(persona.login, lines);
      monthlyPrsByPersona[mi].set(persona.login, prs);
    }
  }

  // 3. Apply dominant window override: for the specified months, elevate ONE
  //    persona to ~`topShare` of that month's activity on all 3 bases.
  if (p.dominantWindow) {
    const { startIdx, endIdx, topShare } = p.dominantWindow;
    // Pick the 0th persona as the "dominant" one; could be any stable choice
    const dominantLogin = personas[0].login;
    for (let mi = startIdx; mi <= endIdx; mi++) {
      if (mi >= p.months.length) break;
      // Re-balance: set dominant to topShare × current total; split the rest evenly across others.
      // NOTE: values stored as floats — rounding perOther with small denominators (esp. PRs, where
      // currentTotal can be ~20) previously caused the dominant's share to drift outside [45, 55]
      // because `dominant + othersCount × round(remainingBudget / othersCount) ≠ currentTotal`.
      // Exact division preserves `dominant / total = topShare` regardless of persona count.
      for (const bucket of [monthlyCommitsByPersona[mi], monthlyLinesByPersona[mi], monthlyPrsByPersona[mi]]) {
        const currentTotal = Array.from(bucket.values()).reduce((s, v) => s + v, 0);
        if (currentTotal === 0) continue;
        const dominantValue = currentTotal * topShare;
        const othersCount = bucket.size - 1;
        const perOther = othersCount > 0 ? (currentTotal - dominantValue) / othersCount : 0;
        for (const login of bucket.keys()) {
          if (login === dominantLogin) {
            bucket.set(login, dominantValue);
          } else {
            bucket.set(login, perOther);
          }
        }
      }
    }
  }

  // 4. Apply headcountSchedule (D-09 team-size step): deactivate N personas
  //    starting at the given monthIdx. Deactivation means zeroing out their
  //    commits/lines/prs for that month and all later months. delta must be
  //    negative (departure scenario); positive deltas are rejected.
  if (p.headcountSchedule) {
    for (const step of p.headcountSchedule) {
      if (step.delta >= 0) continue;  // only departures supported — additions come from month-1 onwards naturally
      const departingCount = Math.abs(step.delta);
      // Pick the last-N personas as "departing" (stable, predictable choice)
      const departingLogins = personas.slice(-departingCount).map(pp => pp.login);
      for (let mi = step.monthIdx; mi < p.months.length; mi++) {
        for (const login of departingLogins) {
          monthlyCommitsByPersona[mi].set(login, 0);
          monthlyLinesByPersona[mi].set(login, 0);
          monthlyPrsByPersona[mi].set(login, 0);
        }
      }
    }
  }

  return {
    personas,
    months: p.months,
    aiMarkerMonth: p.aiMarkerMonth,
    monthlyCommitsByPersona,
    monthlyLinesByPersona,
    monthlyPrsByPersona,
  };
}

// ─── Base ExportMetadata builder ──────────────────────────────────────────────

// Greek letters for anonymized repo names (matches main app's anonymizer)
const GREEK_LETTERS = [
  'Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta',
  'Iota', 'Kappa', 'Lambda', 'Mu', 'Nu', 'Xi', 'Omicron', 'Pi',
  'Rho', 'Sigma', 'Tau', 'Upsilon', 'Phi', 'Chi', 'Psi', 'Omega',
];

// Animal name pairs for anonymized contributor names (matches main app's anonymizer)
const ADJECTIVES = ['Amber', 'Azure', 'Coral', 'Crimson', 'Crystal', 'Dusk', 'Emerald', 'Frost', 'Golden', 'Ivory',
  'Jade', 'Lunar', 'Misty', 'Onyx', 'Pearl', 'Rose', 'Ruby', 'Silver', 'Steel', 'Teal'];
const ANIMALS = ['Bear', 'Crane', 'Dolphin', 'Eagle', 'Falcon', 'Fox', 'Hawk', 'Heron', 'Jaguar', 'Lynx',
  'Otter', 'Owl', 'Panther', 'Puma', 'Raven', 'Seal', 'Tiger', 'Viper', 'Wolf', 'Wren'];

function animalName(index: number): string {
  const adj = ADJECTIVES[index % ADJECTIVES.length];
  const animal = ANIMALS[Math.floor(index / ADJECTIVES.length) % ANIMALS.length];
  return `${adj} ${animal}`;
}

function buildMetadata(
  repoCount: number,
  aiMarkerDate: string | null,
  referenceDate: Date
): ExportMetadata {
  const repoNames = Array.from({ length: repoCount }, (_, i) => `Repo-${GREEK_LETTERS[i % GREEK_LETTERS.length]}`);
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
    orgName: null,  // Generated test data uses Repo-Alpha names (no org owner)
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

  // Generate 3 join periods (quarters) so ramp-up comparison charts have multiple lines
  const periodsToGenerate = 3;
  for (let p = 0; p < periodsToGenerate; p++) {
    const monthsAgo = 3 + p * 3; // 3, 6, 9 months ago
    const qDate = subMonths(params.referenceDate, monthsAgo);
    const quarter = Math.ceil((qDate.getMonth() + 1) / 3);
    const joinPeriodStr = `${qDate.getFullYear()}-Q${quarter}`;

    // Later cohorts ramp up faster (AI adoption effect)
    const speedMultiplier = 1 + p * 0.15; // older cohorts were slower

    for (let week = 0; week < 12; week++) {
      const rampFraction = week >= params.totalWeeks ? 1.0 : week / params.totalWeeks;
      const avgLinesChanged = Math.round(params.peakLinesPerWeek * rampFraction * jitter(1, 0.1) / speedMultiplier);
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

    const login = animalName(i);

    const preStats: ContributorStats | null = {
      authorLogin: login,
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
        authorLogin: login,
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
      authorLogin: login,
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

// ─── Period metrics helper (profile-driven) ───────────────────────────────────

function buildPeriodMetricsFromProfile(
  profile: ActivityProfile,
  aiMarkerDate: string | null,
  referenceDate: Date
): PeriodMetric[] | null {
  if (aiMarkerDate === null || profile.aiMarkerMonth === null) return null;

  const preIdxs:  number[] = [];
  const postIdxs: number[] = [];
  for (let mi = 0; mi < profile.months.length; mi++) {
    if (profile.months[mi] <= profile.aiMarkerMonth) preIdxs.push(mi);
    else postIdxs.push(mi);
  }

  function agg(indexes: number[]): { avgCommitSize: number; prFrequency: number; activeContributors: number } {
    if (indexes.length === 0) {
      return { avgCommitSize: 0, prFrequency: 0, activeContributors: 0 };
    }
    let totalCommits = 0;
    let totalLines = 0;
    let totalPrs = 0;
    const activeLogins = new Set<string>();
    for (const mi of indexes) {
      for (const [login, commits] of profile.monthlyCommitsByPersona[mi]) {
        totalCommits += commits;
        if (commits > 0) activeLogins.add(login);
      }
      for (const [, lines] of profile.monthlyLinesByPersona[mi]) {
        totalLines += lines;
      }
      for (const [, prs] of profile.monthlyPrsByPersona[mi]) {
        totalPrs += prs;
      }
    }
    const avgCommitSize = totalCommits > 0 ? Math.round(totalLines / totalCommits) : 0;
    // PRs per week per contributor — approximate by dividing by months × 4.33 weeks × activeContributors
    const weeks = indexes.length * 4.33;
    const prFrequency = activeLogins.size > 0 && weeks > 0
      ? Math.round((totalPrs / weeks / activeLogins.size) * 100) / 100
      : 0;
    return { avgCommitSize, prFrequency, activeContributors: activeLogins.size };
  }

  const pre = agg(preIdxs);
  const post = agg(postIdxs);

  // D-08 (CONTEXT.md): "rampUpSpeed = (hardcoded for now — ramp-up requires a different
  // data shape; leave at reasonable constants with a comment pointing at Phase 9.5 for the
  // real derivation)". The CONTEXT decision itself grants rampUpSpeed a literal-constant
  // exemption from the "compute from profile" rule. Phase 9.5 is where per-persona per-week
  // ramp-up gets properly derived from time-series data.
  const preRampUp = 8;
  const postRampUp = 6;

  // Delegate period boundaries to the canonical buildPeriodsFromMarker so Pre-AI
  // endDate is the day before the marker (non-overlapping with Post-AI startDate).
  const startDate = format(subMonths(referenceDate, profile.months.length), 'yyyy-MM-dd');
  const endDate = format(referenceDate, 'yyyy-MM-dd');
  const [prePeriod, postPeriod] = buildPeriodsFromMarker(startDate, endDate, aiMarkerDate);

  return [
    {
      period: prePeriod,
      metrics: {
        avgCommitSize: pre.avgCommitSize,
        prFrequency: pre.prFrequency,
        rampUpSpeed: preRampUp,
        activeContributors: pre.activeContributors,
      },
    },
    {
      period: postPeriod,
      metrics: {
        avgCommitSize: post.avgCommitSize,
        prFrequency: post.prFrequency,
        rampUpSpeed: postRampUp,
        activeContributors: post.activeContributors,
      },
    },
  ];
}

// ─── D-09 generator options ────────────────────────────────────────────────────

export interface GenerateOrgOptions {
  includeDominantWindow?: boolean;   // default true for small, false otherwise
  includeBotStormMonth?: boolean;    // default true for small and mid, false for pre-AI baseline
  includeTeamSizeStep?: boolean;     // default true for mid (new mid-org behavior per D-09), false for small and pre-AI
}

// ─── Concentration monthly builder (profile-driven) ───────────────────────────

function buildConcentrationMonthly(profile: ActivityProfile): ConcentrationMonthlyRow[] {
  const rows: ConcentrationMonthlyRow[] = [];
  const bases: Array<'prs' | 'commits' | 'lines'> = ['prs', 'commits', 'lines'];

  for (let mi = 0; mi < profile.months.length; mi++) {
    const month = profile.months[mi];

    for (const basis of bases) {
      const bucket =
        basis === 'prs'    ? profile.monthlyPrsByPersona[mi]
        : basis === 'lines' ? profile.monthlyLinesByPersona[mi]
                            : profile.monthlyCommitsByPersona[mi];

      const entries = Array.from(bucket.entries())
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1]);

      const total = entries.reduce((s, [, v]) => s + v, 0);
      if (entries.length === 0 || total === 0) {
        rows.push({
          month, basis,
          top1Share: null, top3Share: null, top5Share: null,
          hhi: null, gini: null, busFactor: null, activeDevs: 0,
          topContributor: null,
        });
        continue;
      }

      const top1 = entries[0][1];
      const top3 = entries.slice(0, 3).reduce((s, [, v]) => s + v, 0);
      const top5 = entries.slice(0, 5).reduce((s, [, v]) => s + v, 0);

      const top1Share = (top1 / total) * 100;
      const top3Share = (top3 / total) * 100;
      const top5Share = (top5 / total) * 100;

      // HHI: sum of squared shares (share as fraction 0-1)
      const hhi = entries.reduce((s, [, v]) => {
        const share = v / total;
        return s + share * share;
      }, 0);

      // Gini coefficient — approximate via the standard Lorenz curve formula
      const sorted = entries.map(([, v]) => v).sort((a, b) => a - b);
      const n = sorted.length;
      const cumulative = sorted.reduce((sum, v, i) => sum + (2 * (i + 1) - n - 1) * v, 0);
      const gini = total > 0 ? Math.abs(cumulative / (n * total)) : 0;

      // Bus factor: smallest k such that sum(top k shares) >= 0.5
      let busFactor = 1;
      let running = 0;
      for (let i = 0; i < entries.length; i++) {
        running += entries[i][1];
        if (running / total >= 0.5) {
          busFactor = i + 1;
          break;
        }
      }

      rows.push({
        month, basis,
        top1Share,
        top3Share: Math.min(100, top3Share),
        top5Share: Math.min(100, top5Share),
        hhi: Math.min(1, hhi),
        gini: Math.min(1, gini),
        busFactor,
        activeDevs: entries.length,
        topContributor: entries[0][0],  // login of top-1 persona
      });
    }
  }

  return rows;
}

// ─── Headcount monthly builder (profile-driven) ───────────────────────────────

function buildHeadcountMonthly(profile: ActivityProfile): HeadcountMonthlyRow[] {
  return profile.months.map((month, mi) => {
    const commitsBucket = profile.monthlyCommitsByPersona[mi];
    const prsBucket = profile.monthlyPrsByPersona[mi];

    const activeDevs = Array.from(commitsBucket.values()).filter(v => v > 0).length;
    const totalCommits = Array.from(commitsBucket.values()).reduce((s, v) => s + v, 0);
    const totalPrs = Math.round(Array.from(prsBucket.values()).reduce((s, v) => s + v, 0));

    return {
      month,
      activeDevs,
      totalPrs,
      totalCommits,
      prsPerDev: activeDevs > 0 ? totalPrs / activeDevs : null,
      commitsPerDev: activeDevs > 0 ? totalCommits / activeDevs : null,
    };
  });
}

// ─── Bot ratio builder ────────────────────────────────────────────────────────

function buildBotRatio(months: string[], botPct: number, stormMonthIdx?: number): BotRatioRow[] {
  return months.map((month, idx) => {
    const totalCommits = logNormal(5, 0.5);
    const isStorm = stormMonthIdx !== undefined && idx === stormMonthIdx;
    const effectivePct = isStorm ? 0.60 : botPct;
    const botCommits = Math.round(totalCommits * jitter(effectivePct, 0.02));
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
export function generateSmallStartup(options: GenerateOrgOptions = {}): ExportBundle {
  const {
    includeDominantWindow = true,   // D-09 small-org default: true
    includeBotStormMonth  = true,   // D-09 small-org default: true
    includeTeamSizeStep   = false,  // D-09 small-org default: false
  } = options;

  const referenceDate = new Date();
  const aiMarkerDate = format(subMonths(referenceDate, 6), 'yyyy-MM-dd');
  const aiMarkerMonth = format(subMonths(referenceDate, 6), 'yyyy-MM');
  const months = pastMonths(12, referenceDate);

  const contributorCount = 8;
  const repoCount = 2;
  const cohorts = [
    { key: 'new' as const, contributorFraction: 0.25, weight: 0.25 },
    { key: 'mid' as const, contributorFraction: 0.35, weight: 0.35 },
    { key: 'senior' as const, contributorFraction: 0.40, weight: 0.40 },
  ];

  const profile = buildActivityProfile({
    contributorCount,
    months,
    aiMarkerMonth,
    cohorts: cohorts.map(c => ({ key: c.key, weight: c.weight })),
    baseCommitsPerMonth: 12,
    baseLinesPerCommit: 150,
    basePrsPerMonth: 4,
    aiBoostMean: 1.2,
    dominantWindow: includeDominantWindow ? {
      startIdx: Math.floor(months.length * 0.3),
      endIdx:   Math.floor(months.length * 0.3) + 2,
      topShare: 0.50,
    } : undefined,
    headcountSchedule: includeTeamSizeStep ? [{ monthIdx: Math.floor(months.length * 0.6), delta: -3 }] : undefined,
  });

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
  const stormMonthIdx = includeBotStormMonth ? Math.floor(months.length * 0.7) : undefined;
  const botRatio = buildBotRatio(months, 0.05, stormMonthIdx);
  const rolling = buildRolling(referenceDate, 150);

  const totalCommits = cohortCommits.reduce((s, r) => s + r.totalCount, 0);
  const executiveSummary = buildExecutiveSummary(totalCommits, contributorCount, true);

  const periodMetrics = buildPeriodMetricsFromProfile(profile, aiMarkerDate, referenceDate);

  const concentrationMonthly = buildConcentrationMonthly(profile);
  const headcountMonthly = buildHeadcountMonthly(profile);

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
    periodMetrics,
    concentrationMonthly,
    headcountMonthly,
    developerMonthly: [],  // Phase 9.5-01 — type-skeleton stub; Plan 06 wires real archetype data
  };
}

/**
 * Generate a mid-size company ExportBundle.
 * - 80 contributors, 15 repos
 * - Slower ramp-up (full contribution by week 8-10)
 * - AI marker set 4 months ago
 * - More gradual AI adoption curve
 */
export function generateMidSizeCompany(options: GenerateOrgOptions = {}): ExportBundle {
  const {
    includeDominantWindow = false,  // D-09 mid-org default: false (no forced dominant window)
    includeBotStormMonth  = true,   // D-09 mid-org default: true
    includeTeamSizeStep   = true,   // D-09 mid-org default: true — introduces a mid-size team-size step
    // monthIdx: 8, delta: -5 mirrors the `idx === 8 ? -5 : 0` shape from the prior (unused-for-mid)
    // largeShrink branch — it's new mid-org behavior motivated by D-09, not preserved prior behavior.
  } = options;

  const referenceDate = new Date();
  const aiMarkerDate = format(subMonths(referenceDate, 4), 'yyyy-MM-dd');
  const aiMarkerMonth = format(subMonths(referenceDate, 4), 'yyyy-MM');
  const months = pastMonths(12, referenceDate);

  const contributorCount = 80;
  const repoCount = 15;
  const cohorts = [
    { key: 'new' as const, contributorFraction: 0.20, weight: 0.20 },
    { key: 'mid' as const, contributorFraction: 0.30, weight: 0.30 },
    { key: 'senior' as const, contributorFraction: 0.50, weight: 0.50 },
  ];

  const profile = buildActivityProfile({
    contributorCount,
    months,
    aiMarkerMonth,
    cohorts: cohorts.map(c => ({ key: c.key, weight: c.weight })),
    baseCommitsPerMonth: 8,
    baseLinesPerCommit: 120,
    basePrsPerMonth: 3,
    aiBoostMean: 1.1,
    dominantWindow: includeDominantWindow ? {
      startIdx: Math.floor(months.length * 0.3),
      endIdx:   Math.floor(months.length * 0.3) + 2,
      topShare: 0.50,
    } : undefined,
    headcountSchedule: includeTeamSizeStep ? [{ monthIdx: 8, delta: -5 }] : undefined,
  });

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
  const stormMonthIdx = includeBotStormMonth ? Math.floor(months.length * 0.6) : undefined;
  const botRatio = buildBotRatio(months, 0.15, stormMonthIdx);
  const rolling = buildRolling(referenceDate, 120);

  const totalCommits = cohortCommits.reduce((s, r) => s + r.totalCount, 0);
  const executiveSummary = buildExecutiveSummary(totalCommits, contributorCount, true);

  const periodMetrics = buildPeriodMetricsFromProfile(profile, aiMarkerDate, referenceDate);

  const concentrationMonthly = buildConcentrationMonthly(profile);
  const headcountMonthly = buildHeadcountMonthly(profile);

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
    periodMetrics,
    concentrationMonthly,
    headcountMonthly,
    developerMonthly: [],  // Phase 9.5-01 — type-skeleton stub; Plan 06 wires real archetype data
  };
}

/**
 * Generate a pre-AI baseline ExportBundle (control group).
 * - 30 contributors, 8 repos
 * - NO AI marker date (CRITICAL)
 * - Flat, steady metrics with no inflection point
 * - periodMetrics is null (no AI marker = no period comparison)
 */
export function generatePreAiBaseline(options: GenerateOrgOptions = {}): ExportBundle {
  // D-05 regression guard: pre-AI baseline is the control group and MUST remain
  // structurally clean regardless of caller-provided options. Three invariants
  // are enforced below:
  //   1. aiMarkerDate = null (no AI marker)
  //   2. periodMetrics = null (buildPeriodMetricsFromProfile returns null when marker is null)
  //   3. botRatio contains no bot-storm month (`includeBotStormMonth` is ignored here)
  // `includeDominantWindow` and `includeTeamSizeStep` ARE honored because they
  // perturb only the dominantWindow / headcountSchedule of the activity profile
  // and don't violate the control-group contract.
  const {
    includeDominantWindow = false,  // D-09 pre-AI default: false
    includeBotStormMonth  = false,  // D-05 regression guard: default false; forcibly ignored below
    includeTeamSizeStep   = false,  // D-09 pre-AI default: false
  } = options;

  const referenceDate = new Date();
  const months = pastMonths(12, referenceDate);

  const contributorCount = 30;
  const repoCount = 8;
  const cohorts = [
    { key: 'new' as const, contributorFraction: 0.25, weight: 0.25 },
    { key: 'mid' as const, contributorFraction: 0.35, weight: 0.35 },
    { key: 'senior' as const, contributorFraction: 0.40, weight: 0.40 },
  ];

  const profile = buildActivityProfile({
    contributorCount,
    months,
    aiMarkerMonth: null,   // CRITICAL: no AI marker — keeps periodMetrics=null via helper
    cohorts: cohorts.map(c => ({ key: c.key, weight: c.weight })),
    baseCommitsPerMonth: 6,
    baseLinesPerCommit: 100,
    basePrsPerMonth: 2,
    aiBoostMean: 1.0,      // no AI boost (control group)
    dominantWindow: includeDominantWindow ? {
      startIdx: Math.floor(months.length * 0.3),
      endIdx:   Math.floor(months.length * 0.3) + 2,
      topShare: 0.50,
    } : undefined,
    headcountSchedule: includeTeamSizeStep ? [{ monthIdx: Math.floor(months.length * 0.6), delta: -3 }] : undefined,
  });

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
  // D-05 regression guard: pre-AI baseline is the control group — bot storm is
  // NEVER injected, even if the caller passes includeBotStormMonth: true. This
  // prevents accidental leakage into the control-group contract.
  void includeBotStormMonth;  // explicitly ignored; see guard comment above
  const botRatio = buildBotRatio(months, 0.12, undefined);
  const rolling = buildRolling(referenceDate, 100);

  const totalCommits = cohortCommits.reduce((s, r) => s + r.totalCount, 0);
  const executiveSummary: ExecutiveSummary = {
    totalCommits,
    activeContributors: contributorCount,
    rampUpTrend: 'Stable',
    aiAdoptionDelta: null,  // CRITICAL: null because no AI marker
  };

  // buildPeriodMetricsFromProfile returns null because profile.aiMarkerMonth === null (D-05 regression guard)
  const periodMetrics = buildPeriodMetricsFromProfile(profile, null, referenceDate);

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
    periodMetrics,        // CRITICAL: null because aiMarkerMonth is null — guaranteed by buildPeriodMetricsFromProfile
    // generatePreAiBaseline produces a mid-size org (30 contributors, 8 repos);
    // profile-driven concentration/headcount for cross-org analysis consistency.
    concentrationMonthly: buildConcentrationMonthly(profile),
    headcountMonthly: buildHeadcountMonthly(profile),
    developerMonthly: [],  // Phase 9.5-01 — type-skeleton stub; Plan 06 wires real archetype data
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
