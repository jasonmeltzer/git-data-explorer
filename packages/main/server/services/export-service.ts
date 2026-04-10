/**
 * Server-side export data aggregation service.
 *
 * Aggregates all 8 dashboard data sections into a single ExportBundle.
 * Individual section failures are handled gracefully — they return empty arrays or
 * null rather than failing the entire export.
 */

import { createRequire } from 'node:module';
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
import { getBeforeAfterComparison } from './analytics-before-after.js';
import { getAiMarkerDate } from './analytics-config.js';
import { getCohortConfig } from './cohort-config-service.js';
import { getTrackedRepos } from './repo-management.js';

const require = createRequire(import.meta.url);

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
  const pkg = require('../../../package.json') as { version: string };
  const toolVersion: string = pkg.version;

  // ── Build query params ────────────────────────────────────────────────────

  const startDate = new Date(req.startDate);
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
      startDate: req.startDate,
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
      startDate: req.startDate,
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
      startDate: req.startDate,
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

  let beforeAfter: ExportBundle['beforeAfter'] = null;
  try {
    if (aiMarkerDate) {
      const result = getBeforeAfterComparison({ repoIds });
      if (result) {
        // Map from analytics-before-after.BeforeAfterComparison to export-types.BeforeAfterComparison
        beforeAfter = {
          before: {
            avgCommitSize: result.before.avgCommitSize,
            prFrequency: result.before.prFrequency,
            rampUpSpeed: result.before.rampUpSpeed,
            activeContributors: result.before.activeContributors,
          },
          after: {
            avgCommitSize: result.after.avgCommitSize,
            prFrequency: result.after.prFrequency,
            rampUpSpeed: result.after.rampUpSpeed,
            activeContributors: result.after.activeContributors,
          },
          markerDate: result.markerDate,
        };
      }
    }
  } catch (err) {
    console.error('[export-service] beforeAfter failed:', err);
  }

  // ── Build metadata ────────────────────────────────────────────────────────

  const filteredRepos = req.repoIds.length === 0
    ? trackedRepos
    : trackedRepos.filter(r => req.repoIds.includes(r.id));

  const metadata: ExportMetadata = {
    exportTimestamp: new Date().toISOString(),
    startDate: req.startDate,
    endDate: req.endDate,
    aiMarkerDate: aiMarkerDate ? aiMarkerDate.toISOString().split('T')[0] : null,
    tenureMode: req.tenureMode,
    repoIds: req.repoIds,
    repoNames: filteredRepos.map(r => r.fullName),
    cohortConfig,
    toolVersion,
    rollingGranularity: req.rollingGranularity,
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
    beforeAfter,
  };
}
