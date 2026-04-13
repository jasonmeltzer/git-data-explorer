/**
 * Types for the data export feature.
 *
 * NOTE: Server-side analytics types (PrTurnaroundRow, BotRatioRow, ExecutiveSummary,
 * BeforeAfterComparison) are inlined here rather than imported from server services
 * to keep this shared module free of server-only imports (which would break Vite
 * bundling for the client).
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
  periodMonth: string;
  avgHoursToMerge: number;
  medianHoursToMerge: number;
  prCount: number;
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

export interface BeforeAfterMetrics {
  avgCommitSize: number;
  prFrequency: number;
  rampUpSpeed: number | null;
  activeContributors: number;
}

export interface BeforeAfterComparison {
  before: BeforeAfterMetrics;
  after: BeforeAfterMetrics;
  markerDate: string;
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
  beforeAfter: BeforeAfterComparison | null;
}

export interface ExportRequest {
  startDate: string;              // ISO datetime
  endDate: string;                // ISO datetime
  repoIds: number[];
  tenureMode: TenureMode;
  rollingGranularity: RollingGranularity;
}
