/**
 * Types for the data export feature.
 *
 * NOTE: Server-side analytics types (PrTurnaroundRow, BotRatioRow, ExecutiveSummary,
 * ConcentrationMonthlyRow, HeadcountMonthlyRow, DeveloperMonthlyRow, Period,
 * PeriodMetric) are inlined here rather than imported from server services to keep
 * this shared module free of server-only imports (which would break Vite bundling
 * for the client).
 */

import type {
  CohortMetricsRow,
  RampUpBucket,
  RollingComparisonResult,
  ContributorBeforeAfterStats,
  TenureMode,
  RollingGranularity,
} from './types.js';
import type { CohortConfig } from './cohort-config.js';

// ─── Inlined server-side analytics types ─────────────────────────────────────
// These match the interfaces in their respective analytics service files.
// Keep in sync manually if those interfaces change.

export interface PrTurnaroundRow {
  periodMonth: string;            // 'YYYY-MM'
  medianHoursToMerge: number;     // TRUE median via TypeScript post-processing
  avgHoursToMerge: number;        // real mean (unchanged formula, from filtered set)
  prCount: number;                // covered PRs only — feeds the medians
  totalPrCount: number;           // total PRs in period including excluded — feeds coverage caveat
}

export interface BotRatioRow {
  periodMonth: string;
  botCommits: number;
  humanCommits: number;
  totalCommits: number;
  botPercentage: number;
}

export interface ExecutiveSummary {
  totalCommits: number;
  activeContributors: number;
  rampUpTrend: string | null;
  aiAdoptionDelta: string | null;
}

// ─── Inlined Phase 9.4 types (matching shared/types.ts) ──────────────────────
// Inlined per Phase 08 convention: shared module must not import from server.

export interface Period {
  startDate: string;   // ISO date string
  endDate: string;     // ISO date string
  label: string;
  markerDate?: string; // ISO date string, for chart marker decoration
}

export interface PeriodMetric {
  period: Period;
  metrics: Record<string, number | null>;
}

export type ConcentrationBasis = 'prs' | 'commits' | 'lines';

export interface ConcentrationMonthlyRow {
  month: string;            // 'YYYY-MM'
  basis: ConcentrationBasis;
  top1Share: number | null; // 0-100 (percentage), null if zero activity for this basis
  top3Share: number | null;
  top5Share: number | null;
  hhi: number | null;       // 0-1 scale
  gini: number | null;      // 0-1 scale
  busFactor: number | null; // devsToReach50Pct, integer
  activeDevs: number;       // always populated (commit-OR-PR definition)
  topContributor: string | null; // github_login of top-1 contributor for chart annotation
}

export interface HeadcountMonthlyRow {
  month: string;               // 'YYYY-MM'
  activeDevs: number;          // commit-OR-PR active definition (D-09)
  totalPrs: number;
  totalCommits: number;
  prsPerDev: number | null;    // null if activeDevs=0
  commitsPerDev: number | null;
}

/**
 * Per-developer monthly time series row (Phase 9.5).
 * Inlined here per the server-isolation contract; matches DeveloperMonthlyRow
 * in @shared/types.ts. Keep the two definitions in sync manually.
 */
export interface DeveloperMonthlyRow {
  authorLogin: string;            // raw login in main app, animal name post-anonymizer
  month: string;                  // 'YYYY-MM' UTC
  prCount: number;
  commitCount: number;
  meanLinesPerCommit: number | null;     // null when commitCount = 0
  medianLinesPerCommit: number | null;
  meanFilesPerCommit: number | null;
  medianFilesPerCommit: number | null;
}

// ─── Export feature types ─────────────────────────────────────────────────────

export interface ExportMetadata {
  exportTimestamp: string;        // ISO
  startDate: string;
  endDate: string;
  aiMarkerDate: string | null;
  tenureMode: TenureMode;
  repoIds: number[];
  repoNames: string[];
  cohortConfig: CohortConfig;
  toolVersion: string;            // from package.json "version" field
  rollingGranularity: RollingGranularity;
  orgName: string | null;         // D-06: nullable for backward compat + opt-out
}

export interface ExportBundle {
  metadata: ExportMetadata;
  cohortCommits: CohortMetricsRow[];
  cohortPrs: CohortMetricsRow[];
  rampUp: RampUpBucket[];
  rolling: RollingComparisonResult | null;
  contributors: ContributorBeforeAfterStats[];
  prTurnaround: PrTurnaroundRow[];
  botRatio: BotRatioRow[];
  executiveSummary: ExecutiveSummary | null;
  periodMetrics: PeriodMetric[] | null;             // replaces beforeAfter (D-13)
  concentrationMonthly: ConcentrationMonthlyRow[];  // NEW (Phase 9.4)
  headcountMonthly: HeadcountMonthlyRow[];           // NEW (Phase 9.4)
  developerMonthly: DeveloperMonthlyRow[];           // NEW (Phase 9.5)
}

export interface ExportRequest {
  startDate: string;              // ISO datetime
  endDate: string;                // ISO datetime
  repoIds: number[];
  tenureMode: TenureMode;
  rollingGranularity: RollingGranularity;
}
