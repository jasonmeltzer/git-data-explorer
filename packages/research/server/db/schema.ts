import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';

export const orgs = sqliteTable('orgs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  label: text('label').notNull(),
  sizeCategory: text('size_category'),           // 'small' | 'medium' | 'large'
  importSource: text('import_source'),            // 'file' | 'gist' | 'url' | 'batch'
  createdAt: integer('created_at').notNull(),
});

export const snapshots = sqliteTable('snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  orgId: integer('org_id').notNull().references(() => orgs.id),
  importTimestamp: integer('import_timestamp').notNull(),
  metadataJson: text('metadata_json').notNull(),
  toolVersion: text('tool_version'),
  startDate: text('start_date'),
  endDate: text('end_date'),
  aiMarkerDate: text('ai_marker_date'),
  contributorCount: integer('contributor_count'),
  repoCount: integer('repo_count'),
  contentHash: text('content_hash'),              // SHA-256 for dedup detection
  executiveSummaryJson: text('executive_summary_json'),
  // beforeAfterJson removed in Phase 9.4 (D-13) — replaced by periodMetrics table
});

export const cohortMetrics = sqliteTable('cohort_metrics', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  snapshotId: integer('snapshot_id').notNull().references(() => snapshots.id),
  orgId: integer('org_id').notNull().references(() => orgs.id),
  metricType: text('metric_type').notNull(),       // 'commits' | 'prs'
  cohort: text('cohort').notNull(),
  period: text('period').notNull(),
  periodMonth: text('period_month').notNull(),
  avgLinesAdded: real('avg_lines_added').notNull(),
  avgLinesDeleted: real('avg_lines_deleted').notNull(),
  avgFilesChanged: real('avg_files_changed').notNull(),
  totalCount: integer('total_count').notNull(),
  contributorCount: integer('contributor_count').notNull(),
}, (table) => [
  index('idx_cohort_metrics_org').on(table.orgId, table.metricType),
  index('idx_cohort_metrics_snapshot').on(table.snapshotId),
]);

export const rampUp = sqliteTable('ramp_up', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  snapshotId: integer('snapshot_id').notNull().references(() => snapshots.id),
  orgId: integer('org_id').notNull().references(() => orgs.id),
  weekIndex: integer('week_index').notNull(),
  avgLinesChanged: real('avg_lines_changed').notNull(),
  avgFilesChanged: real('avg_files_changed').notNull(),
  contributionCount: integer('contribution_count').notNull(),
  contributorCount: integer('contributor_count').notNull(),
  joinPeriod: text('join_period').notNull(),
}, (table) => [
  index('idx_ramp_up_org').on(table.orgId),
]);

export const rollingComparisons = sqliteTable('rolling_comparisons', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  snapshotId: integer('snapshot_id').notNull().references(() => snapshots.id),
  orgId: integer('org_id').notNull().references(() => orgs.id),
  dataJson: text('data_json').notNull(),
});

export const contributors = sqliteTable('contributors', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  snapshotId: integer('snapshot_id').notNull().references(() => snapshots.id),
  orgId: integer('org_id').notNull().references(() => orgs.id),
  authorLogin: text('author_login').notNull(),
  cohort: text('cohort').notNull(),
  firstCommitAt: text('first_commit_at'),
  preJson: text('pre_json'),
  postJson: text('post_json'),
}, (table) => [
  index('idx_contributors_org').on(table.orgId),
]);

export const prTurnaround = sqliteTable('pr_turnaround', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  snapshotId: integer('snapshot_id').notNull().references(() => snapshots.id),
  orgId: integer('org_id').notNull().references(() => orgs.id),
  periodMonth: text('period_month').notNull(),
  avgHoursToMerge: real('avg_hours_to_merge').notNull(),
  medianHoursToMerge: real('median_hours_to_merge').notNull(),
  prCount: integer('pr_count').notNull(),
}, (table) => [
  index('idx_pr_turnaround_org').on(table.orgId),
]);

export const botRatio = sqliteTable('bot_ratio', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  snapshotId: integer('snapshot_id').notNull().references(() => snapshots.id),
  orgId: integer('org_id').notNull().references(() => orgs.id),
  periodMonth: text('period_month').notNull(),
  botCommits: integer('bot_commits').notNull(),
  humanCommits: integer('human_commits').notNull(),
  totalCommits: integer('total_commits').notNull(),
  botPercentage: real('bot_percentage').notNull(),
}, (table) => [
  index('idx_bot_ratio_org').on(table.orgId),
]);

export const concentrationMonthly = sqliteTable('concentration_monthly', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  snapshotId: integer('snapshot_id').notNull().references(() => snapshots.id),
  orgId: integer('org_id').notNull().references(() => orgs.id),
  basis: text('basis').notNull(),            // 'prs' | 'commits' | 'lines'
  periodMonth: text('period_month').notNull(),
  top1Share: real('top1_share'),             // nullable for zero-activity months
  top3Share: real('top3_share'),
  top5Share: real('top5_share'),
  hhi: real('hhi'),
  gini: real('gini'),
  busFactor: integer('bus_factor'),
  activeDevs: integer('active_devs').notNull(),
  topContributor: text('top_contributor'),
}, (table) => [
  index('idx_concentration_monthly_org').on(table.orgId, table.basis),
]);

export const headcountMonthly = sqliteTable('headcount_monthly', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  snapshotId: integer('snapshot_id').notNull().references(() => snapshots.id),
  orgId: integer('org_id').notNull().references(() => orgs.id),
  periodMonth: text('period_month').notNull(),
  activeDevs: integer('active_devs').notNull(),
  totalPrs: integer('total_prs').notNull(),
  totalCommits: integer('total_commits').notNull(),
  prsPerDev: real('prs_per_dev'),
  commitsPerDev: real('commits_per_dev'),
}, (table) => [
  index('idx_headcount_monthly_org').on(table.orgId),
]);

/**
 * Phase 9.5 — per-developer monthly time series mirror table.
 * Mirrors DeveloperMonthlyRow shape; indexed by snapshot_id (per D-16 access pattern).
 * Per-commit size columns are nullable to encode zero-commit months (D-19).
 */
export const developerMonthly = sqliteTable('developer_monthly', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  snapshotId: integer('snapshot_id').notNull().references(() => snapshots.id),
  orgId: integer('org_id').notNull().references(() => orgs.id),
  authorLogin: text('author_login').notNull(),
  periodMonth: text('period_month').notNull(),
  prCount: integer('pr_count').notNull(),
  commitCount: integer('commit_count').notNull(),
  meanLinesPerCommit: real('mean_lines_per_commit'),
  medianLinesPerCommit: real('median_lines_per_commit'),
  meanFilesPerCommit: real('mean_files_per_commit'),
  medianFilesPerCommit: real('median_files_per_commit'),
}, (table) => [
  index('idx_developer_monthly_snapshot_month').on(table.snapshotId, table.periodMonth),
  index('idx_developer_monthly_snapshot_author').on(table.snapshotId, table.authorLogin),
]);

export const periodMetrics = sqliteTable('period_metrics', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  snapshotId: integer('snapshot_id').notNull().references(() => snapshots.id),
  orgId: integer('org_id').notNull().references(() => orgs.id),
  dataJson: text('data_json').notNull(),     // JSON-serialized PeriodMetric[]
});
