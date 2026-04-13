import { z } from 'zod';

const CohortThresholdSchema = z.object({
  maxMonths: z.number().nullable(),
  key: z.string(),
  label: z.string(),
  color: z.string(),
});

const CohortConfigSchema = z.object({
  thresholds: z.tuple([CohortThresholdSchema, CohortThresholdSchema, CohortThresholdSchema]),
});

const ExportMetadataSchema = z.object({
  exportTimestamp: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  aiMarkerDate: z.string().nullable(),
  tenureMode: z.enum(['global', 'repo']),
  repoIds: z.array(z.number()),
  repoNames: z.array(z.string()),
  cohortConfig: CohortConfigSchema,
  toolVersion: z.string(),
  rollingGranularity: z.enum(['month', 'quarter']),
  orgName: z.string().nullable().optional(),  // D-06: nullable, optional for backward compat
});

const CohortMetricsRowSchema = z.object({
  cohort: z.string(),
  period: z.enum(['before', 'after', 'all']),
  periodMonth: z.string(),
  avgLinesAdded: z.number(),
  avgLinesDeleted: z.number(),
  avgFilesChanged: z.number(),
  totalCount: z.number(),
  contributorCount: z.number(),
});

const RampUpBucketSchema = z.object({
  weekIndex: z.number(),
  avgLinesChanged: z.number(),
  avgFilesChanged: z.number(),
  contributionCount: z.number(),
  contributorCount: z.number(),
  joinPeriod: z.string(),
});

// ContributorStats shape matches the shared ContributorStats interface in @shared/types.ts
// Fields: totalCommits, totalPrs, avgLinesAdded, avgLinesDeleted, avgFilesChanged, firstCommitAt, authorLogin, cohort
// These match the actual ExportBundle.contributors[].pre / .post shape produced by the export service.
const ContributorStatsSchema = z.object({
  authorLogin: z.string(),
  cohort: z.string(),
  totalCommits: z.number(),
  totalPrs: z.number(),
  avgLinesAdded: z.number(),
  avgLinesDeleted: z.number(),
  avgFilesChanged: z.number(),
  firstCommitAt: z.string(),
}).nullable();

const ContributorBeforeAfterSchema = z.object({
  authorLogin: z.string(),
  cohort: z.string(),
  firstCommitAt: z.string().nullable(),
  repoId: z.number().optional(),
  pre: ContributorStatsSchema,
  post: ContributorStatsSchema,
});

const PrTurnaroundRowSchema = z.object({
  periodMonth: z.string(),
  avgHoursToMerge: z.number(),
  medianHoursToMerge: z.number(),
  prCount: z.number(),
});

const BotRatioRowSchema = z.object({
  periodMonth: z.string(),
  botCommits: z.number(),
  humanCommits: z.number(),
  totalCommits: z.number(),
  botPercentage: z.number(),
});

export const ExportBundleSchema = z.object({
  metadata: ExportMetadataSchema,
  cohortCommits: z.array(CohortMetricsRowSchema).default([]),
  cohortPrs: z.array(CohortMetricsRowSchema).default([]),
  rampUp: z.array(RampUpBucketSchema).default([]),
  rolling: z.unknown().nullable().default(null),
  contributors: z.array(ContributorBeforeAfterSchema).default([]),
  prTurnaround: z.array(PrTurnaroundRowSchema).default([]),
  botRatio: z.array(BotRatioRowSchema).default([]),
  executiveSummary: z.unknown().nullable().default(null),
  beforeAfter: z.unknown().nullable().default(null),
});

export type ValidationResult = {
  valid: boolean;
  data?: z.infer<typeof ExportBundleSchema>;
  errors?: string[];
  warnings: string[];
};

export function validateBundle(raw: unknown): ValidationResult {
  const warnings: string[] = [];
  const result = ExportBundleSchema.safeParse(raw);

  if (!result.success) {
    return {
      valid: false,
      errors: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
      warnings,
    };
  }

  const data = result.data;

  // Generate warnings for missing/empty optional sections
  if (!data.rolling) warnings.push('rolling section is null');
  if (!data.executiveSummary) warnings.push('executiveSummary section is null');
  if (!data.beforeAfter) warnings.push('beforeAfter section is null');
  if (data.cohortCommits.length === 0) warnings.push('cohortCommits is empty');
  if (data.cohortPrs.length === 0) warnings.push('cohortPrs is empty');
  if (data.contributors.length === 0) warnings.push('contributors is empty');

  return { valid: true, data, warnings };
}
