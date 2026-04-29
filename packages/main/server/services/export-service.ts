/**
 * Server-side export data aggregation service.
 *
 * Aggregates all 12 dashboard data sections into a single ExportBundle.
 * Individual section failures are handled gracefully — they return empty arrays or
 * null rather than failing the entire export.
 */

import { createRequire } from 'node:module';
import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import type {
  ExportBundle,
  ExportRequest,
  ExportMetadata,
} from '@shared/export-types.js';
import { getCohortCommitMetrics, getCohortPrMetrics } from './analytics-cohorts.js';
import { getRampUpCurves } from './analytics-rampup.js';
import { getRollingComparison } from './analytics-rolling.js';
import { getContributorStats, getContributorBeforeAfterStats } from './analytics-contributors.js';
import { getPrTurnaroundTrend } from './analytics-pr-turnaround.js';
import { getBotRatioTrend } from './analytics-bot-ratio.js';
import { getExecutiveSummary } from './analytics-summary.js';
import { getAiMarkerDate } from './analytics-config.js';
import { getConcentrationMonthly } from './analytics-concentration.js';
import { getHeadcountMonthly } from './analytics-headcount.js';
import { getDeveloperMonthly } from './analytics-developer-monthly.js';
import { getPeriodMetrics } from './analytics-period-metrics.js';
import { buildPeriodsFromMarker } from '@shared/lib/periods.js';
import { getCohortConfig } from './cohort-config-service.js';
import { getTrackedRepos } from './repo-management.js';

const require = createRequire(import.meta.url);

/**
 * Infer orgName from repo fullNames per D-07.
 * Single owner => that owner. Multiple => joined with '+' alphabetically. Empty/malformed => null.
 */
export function inferOrgName(repoNames: string[]): string | null {
  const owners = repoNames
    .map(name => {
      const slash = name.indexOf('/');
      return slash > 0 ? name.slice(0, slash) : null;
    })
    .filter((o): o is string => o !== null && o.length > 0);

  if (owners.length === 0) return null;

  const unique = [...new Set(owners)].sort();
  return unique.join('+');
}

/**
 * Aggregates all dashboard analytics sections into a single exportable bundle.
 *
 * @param req - ExportRequest with date range, repo filter, and display preferences
 * @returns Complete ExportBundle with all 10 top-level keys populated
 */
export function buildExportBundle(req: ExportRequest): ExportBundle {
  // ── Read shared config ────────────────────────────────────────────────────

  const aiMarkerDate = getAiMarkerDate();
  const cohortConfig = getCohortConfig();
  const trackedRepos = getTrackedRepos();

  // Read tool version from package.json
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pkg = require('../../../../package.json') as { version: string };
  const toolVersion: string = pkg.version;

  // ── Build query params ────────────────────────────────────────────────────

  // If the client sent an epoch-adjacent startDate (the "All" preset uses
  // new Date(0)), substitute the earliest actual commit date across the
  // selected repos so metadata.startDate reads as a real date rather than
  // "Dec 1969" in downstream UIs. Mirrors the H1 fix already applied to the
  // analytics routes.
  const reqStartMs = new Date(req.startDate).getTime();
  const MIN_MEANINGFUL_MS = new Date('2000-01-01').getTime();
  let effectiveStartIso = req.startDate;
  if (reqStartMs < MIN_MEANINGFUL_MS) {
    const repoFilter = req.repoIds.length > 0
      ? `WHERE repo_id IN (${req.repoIds.filter(n => Number.isInteger(n) && n > 0).join(',')})`
      : '';
    const row = db.all(sql.raw(
      `SELECT MIN(CAST(committed_at AS INTEGER)) AS minEpoch FROM commits ${repoFilter}`,
    )) as Array<{ minEpoch: number | null }>;
    const minEpoch = row[0]?.minEpoch ?? null;
    if (minEpoch !== null) {
      effectiveStartIso = new Date(minEpoch * 1000).toISOString();
    }
  }

  const startDate = new Date(effectiveStartIso);
  const endDate = new Date(req.endDate);
  const repoIds = req.repoIds.length > 0 ? req.repoIds : undefined;

  // ── Analytics section calls — each wrapped for graceful degradation ───────

  let cohortCommits: ExportBundle['cohortCommits'] = [];
  try {
    cohortCommits = getCohortCommitMetrics({
      startDate,
      endDate,
      tenureMode: req.tenureMode,
      repoIds,
      aiMarkerDate,
    });
  } catch (err) {
    console.error('[export-service] cohortCommits failed:', err);
  }

  let cohortPrs: ExportBundle['cohortPrs'] = [];
  try {
    cohortPrs = getCohortPrMetrics({
      startDate,
      endDate,
      tenureMode: req.tenureMode,
      repoIds,
      aiMarkerDate,
    });
  } catch (err) {
    console.error('[export-service] cohortPrs failed:', err);
  }

  let rampUp: ExportBundle['rampUp'] = [];
  try {
    rampUp = getRampUpCurves({
      tenureMode: req.tenureMode,
      repoIds,
      joinPeriodGranularity: 'quarter',
    });
  } catch (err) {
    console.error('[export-service] rampUp failed:', err);
  }

  let rolling: ExportBundle['rolling'] = null;
  try {
    rolling = getRollingComparison({
      granularity: req.rollingGranularity,
      repoIds,
    });
  } catch (err) {
    console.error('[export-service] rolling failed:', err);
  }

  let contributors: ExportBundle['contributors'] = [];
  try {
    if (aiMarkerDate) {
      const result = getContributorBeforeAfterStats({
        startDate,
        endDate,
        aiMarkerDate,
        tenureMode: req.tenureMode,
        repoIds,
      });
      // Cast: getContributorBeforeAfterStats may return ContributorBeforeAfterStats[]
      // or ContributorRepoBeforeAfterStats[] depending on tenureMode.
      // For export, we treat both as ContributorBeforeAfterStats[] (compatible shape).
      contributors = result as ExportBundle['contributors'];
    } else {
      // No AI marker — use base contributor stats and wrap in ContributorBeforeAfterStats shape
      const stats = getContributorStats({ startDate, endDate, tenureMode: req.tenureMode, repoIds });
      contributors = (stats as Array<{ authorLogin: string; cohort: string; firstCommitAt: string }>).map(s => ({
        authorLogin: s.authorLogin,
        cohort: s.cohort,
        firstCommitAt: s.firstCommitAt,
        pre: null,
        post: null,
      }));
    }
  } catch (err) {
    console.error('[export-service] contributors failed:', err);
  }

  let prTurnaround: ExportBundle['prTurnaround'] = [];
  try {
    const result = getPrTurnaroundTrend({
      startDate: effectiveStartIso,
      endDate: req.endDate,
      repoIds,
    });
    // Map from analytics-pr-turnaround.PrTurnaroundRow to export-types.PrTurnaroundRow
    prTurnaround = result.map(r => ({
      periodMonth: r.periodMonth,
      avgHoursToMerge: r.avgHoursToMerge,
      medianHoursToMerge: r.medianHoursToMerge,
      prCount: r.prCount,
    }));
  } catch (err) {
    console.error('[export-service] prTurnaround failed:', err);
  }

  let botRatio: ExportBundle['botRatio'] = [];
  try {
    const result = getBotRatioTrend({
      startDate: effectiveStartIso,
      endDate: req.endDate,
      repoIds,
    });
    // Map from analytics-bot-ratio.BotRatioRow to export-types.BotRatioRow
    botRatio = result.map(r => ({
      periodMonth: r.periodMonth,
      botCommits: r.botCommits,
      humanCommits: r.humanCommits,
      totalCommits: r.totalCommits,
      botPercentage: r.botPercentage,
    }));
  } catch (err) {
    console.error('[export-service] botRatio failed:', err);
  }

  let executiveSummary: ExportBundle['executiveSummary'] = null;
  try {
    const result = getExecutiveSummary({
      startDate: effectiveStartIso,
      endDate: req.endDate,
      repoIds,
    });
    // Map from analytics-summary.ExecutiveSummary to export-types.ExecutiveSummary
    executiveSummary = {
      totalCommits: result.totalCommits,
      activeContributors: result.activeContributors,
      rampUpTrend: result.rampUpTrend,
      aiAdoptionDelta: result.aiAdoptionDelta,
    };
  } catch (err) {
    console.error('[export-service] executiveSummary failed:', err);
  }

  // ── Build Period[] for new Phase 9.4 services ────────────────────────────
  const markerDateStr = aiMarkerDate
    ? aiMarkerDate.toISOString().slice(0, 10)
    : null;
  const periods = buildPeriodsFromMarker(effectiveStartIso.slice(0, 10), req.endDate.slice(0, 10), markerDateStr);

  let periodMetrics: ExportBundle['periodMetrics'] = null;
  try {
    periodMetrics = getPeriodMetrics(repoIds, periods);
  } catch (err) {
    console.error('[export-service] periodMetrics failed:', err);
  }

  let concentrationMonthly: ExportBundle['concentrationMonthly'] = [];
  try {
    concentrationMonthly = getConcentrationMonthly(repoIds, periods);
  } catch (err) {
    console.error('[export-service] concentrationMonthly failed:', err);
  }

  let headcountMonthly: ExportBundle['headcountMonthly'] = [];
  try {
    headcountMonthly = getHeadcountMonthly(repoIds, periods);
  } catch (err) {
    console.error('[export-service] headcountMonthly failed:', err);
  }

  let developerMonthly: ExportBundle['developerMonthly'] = [];
  try {
    developerMonthly = getDeveloperMonthly(repoIds, periods);
  } catch (err) {
    console.error('[export-service] developerMonthly failed:', err);
  }

  // ── Build metadata ────────────────────────────────────────────────────────

  const filteredRepos = req.repoIds.length === 0
    ? trackedRepos
    : trackedRepos.filter(r => req.repoIds.includes(r.id));

  const metadata: ExportMetadata = {
    exportTimestamp: new Date().toISOString(),
    startDate: effectiveStartIso,
    endDate: req.endDate,
    aiMarkerDate: aiMarkerDate ? aiMarkerDate.toISOString().split('T')[0] : null,
    tenureMode: req.tenureMode,
    repoIds: req.repoIds,
    repoNames: filteredRepos.map(r => r.fullName),
    cohortConfig,
    toolVersion,
    rollingGranularity: req.rollingGranularity,
    orgName: inferOrgName(filteredRepos.map(r => r.fullName)),
  };

  // ── Return assembled bundle ───────────────────────────────────────────────

  return {
    metadata,
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
    developerMonthly,
  };
}
