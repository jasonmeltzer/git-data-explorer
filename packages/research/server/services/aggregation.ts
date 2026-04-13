/**
 * Cross-org aggregation service.
 *
 * Provides two aggregation modes:
 * - weighted: larger orgs (by contributor count) contribute proportionally more weight
 * - normalized: each org counts equally regardless of size
 *
 * Uses the latest snapshot per org for all queries.
 */

import { sql, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { orgs, snapshots, cohortMetrics, rampUp } from '../db/schema.js';
import type { CohortMetricsRow, RampUpBucket } from '@shared/types.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OrgComparisonRow {
  id: number;
  label: string;
  sizeCategory: string | null;
  snapshotCount: number;
  contributorCount: number | null;
  repoCount: number | null;
  aiMarkerDate: string | null;
  avgCommitSize: number | null;
  rampUpWeeks: number | null;
}

// ─── Helper: latest snapshot per org ─────────────────────────────────────────

/**
 * Returns a Map<orgId, snapshotId> for the most recent snapshot per org.
 * Uses MAX(import_timestamp) to pick the latest import.
 */
export function getLatestSnapshotIds(orgIds: number[]): Map<number, number> {
  if (orgIds.length === 0) return new Map();

  // SAFETY: orgIds come from internal calls, never raw user input.
  // Use Drizzle inArray for parameterized query safety.
  const rows = db.all(sql.raw(`
    SELECT org_id, id AS snapshot_id
    FROM snapshots
    WHERE org_id IN (${orgIds.join(',')})
      AND import_timestamp = (
        SELECT MAX(s2.import_timestamp)
        FROM snapshots s2
        WHERE s2.org_id = snapshots.org_id
      )
    ORDER BY org_id
  `)) as Array<{ org_id: number; snapshot_id: number }>;

  const result = new Map<number, number>();
  for (const row of rows) {
    result.set(row.org_id, row.snapshot_id);
  }
  return result;
}

// ─── Cohort metrics aggregation ───────────────────────────────────────────────

/**
 * Aggregate cohort metrics across multiple orgs.
 *
 * @param mode - 'weighted': weight by contributor_count. 'normalized': each org counts equally.
 * @param orgIds - list of org IDs to include
 * @param metricType - 'commits' or 'prs'
 * @returns CohortMetricsRow[] aggregated across the specified orgs
 */
export function getAggregatedCohortMetrics(
  mode: 'weighted' | 'normalized',
  orgIds: number[],
  metricType: 'commits' | 'prs'
): CohortMetricsRow[] {
  if (orgIds.length === 0) return [];
  // Defense-in-depth: validate metricType even though TypeScript constrains it
  if (metricType !== 'commits' && metricType !== 'prs') {
    throw new Error(`Invalid metricType: ${String(metricType)}`);
  }

  const snapshotMap = getLatestSnapshotIds(orgIds);
  if (snapshotMap.size === 0) return [];

  const snapshotIds = Array.from(snapshotMap.values());

  if (mode === 'weighted') {
    // Weighted: SUM(metric * contributor_count) / NULLIF(SUM(contributor_count), 0)
    // Groups by cohort, period, period_month across all selected snapshots
    const rows = db.all(sql.raw(`
      SELECT
        cohort,
        period,
        period_month,
        COALESCE(
          SUM(avg_lines_added * contributor_count) / NULLIF(SUM(contributor_count), 0),
          0
        ) AS avg_lines_added,
        COALESCE(
          SUM(avg_lines_deleted * contributor_count) / NULLIF(SUM(contributor_count), 0),
          0
        ) AS avg_lines_deleted,
        COALESCE(
          SUM(avg_files_changed * contributor_count) / NULLIF(SUM(contributor_count), 0),
          0
        ) AS avg_files_changed,
        SUM(total_count) AS total_count,
        SUM(contributor_count) AS contributor_count
      FROM cohort_metrics
      WHERE snapshot_id IN (${snapshotIds.join(',')})
        AND metric_type = '${metricType}'
      GROUP BY cohort, period, period_month
      ORDER BY period_month, cohort, period
    `)) as Array<{
      cohort: string;
      period: string;
      period_month: string;
      avg_lines_added: number;
      avg_lines_deleted: number;
      avg_files_changed: number;
      total_count: number;
      contributor_count: number;
    }>;

    return rows.map(r => ({
      cohort: r.cohort,
      period: r.period as 'before' | 'after' | 'all',
      periodMonth: r.period_month,
      avgLinesAdded: r.avg_lines_added ?? 0,
      avgLinesDeleted: r.avg_lines_deleted ?? 0,
      avgFilesChanged: r.avg_files_changed ?? 0,
      totalCount: r.total_count,
      contributorCount: r.contributor_count,
    }));
  } else {
    // Normalized: compute per-org averages, then AVG across orgs (each org counts equally)
    // Step 1: get per-org per-group metrics
    const perOrgRows = db.all(sql.raw(`
      SELECT
        org_id,
        cohort,
        period,
        period_month,
        AVG(avg_lines_added) AS avg_lines_added,
        AVG(avg_lines_deleted) AS avg_lines_deleted,
        AVG(avg_files_changed) AS avg_files_changed,
        SUM(total_count) AS total_count,
        SUM(contributor_count) AS contributor_count
      FROM cohort_metrics
      WHERE snapshot_id IN (${snapshotIds.join(',')})
        AND metric_type = '${metricType}'
      GROUP BY org_id, cohort, period, period_month
    `)) as Array<{
      org_id: number;
      cohort: string;
      period: string;
      period_month: string;
      avg_lines_added: number;
      avg_lines_deleted: number;
      avg_files_changed: number;
      total_count: number;
      contributor_count: number;
    }>;

    // Step 2: group by (cohort, period, period_month) and avg across orgs
    const groups = new Map<string, typeof perOrgRows>();
    for (const row of perOrgRows) {
      const key = `${row.cohort}|${row.period}|${row.period_month}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }

    const result: CohortMetricsRow[] = [];
    for (const [key, groupRows] of groups) {
      const [cohort, period, periodMonth] = key.split('|');
      const n = groupRows.length;
      result.push({
        cohort,
        period: period as 'before' | 'after' | 'all',
        periodMonth,
        avgLinesAdded: groupRows.reduce((s, r) => s + r.avg_lines_added, 0) / n,
        avgLinesDeleted: groupRows.reduce((s, r) => s + r.avg_lines_deleted, 0) / n,
        avgFilesChanged: groupRows.reduce((s, r) => s + r.avg_files_changed, 0) / n,
        totalCount: groupRows.reduce((s, r) => s + r.total_count, 0),
        contributorCount: groupRows.reduce((s, r) => s + r.contributor_count, 0),
      });
    }

    // Sort by period_month, cohort, period for consistent output
    result.sort((a, b) =>
      a.periodMonth.localeCompare(b.periodMonth) ||
      a.cohort.localeCompare(b.cohort) ||
      a.period.localeCompare(b.period)
    );

    return result;
  }
}

// ─── Ramp-up aggregation ──────────────────────────────────────────────────────

/**
 * Aggregate ramp-up curves across multiple orgs.
 *
 * @param mode - 'weighted' or 'normalized'
 * @param orgIds - list of org IDs to include
 * @returns RampUpBucket[] aggregated across orgs, grouped by (weekIndex, joinPeriod)
 */
export function getAggregatedRampUp(
  mode: 'weighted' | 'normalized',
  orgIds: number[]
): RampUpBucket[] {
  if (orgIds.length === 0) return [];

  const snapshotMap = getLatestSnapshotIds(orgIds);
  if (snapshotMap.size === 0) return [];

  const snapshotIds = Array.from(snapshotMap.values());

  if (mode === 'weighted') {
    const rows = db.all(sql.raw(`
      SELECT
        week_index,
        join_period,
        COALESCE(
          SUM(avg_lines_changed * contributor_count) / NULLIF(SUM(contributor_count), 0),
          0
        ) AS avg_lines_changed,
        COALESCE(
          SUM(avg_files_changed * contributor_count) / NULLIF(SUM(contributor_count), 0),
          0
        ) AS avg_files_changed,
        SUM(contribution_count) AS contribution_count,
        SUM(contributor_count) AS contributor_count
      FROM ramp_up
      WHERE snapshot_id IN (${snapshotIds.join(',')})
      GROUP BY week_index, join_period
      ORDER BY join_period, week_index
    `)) as Array<{
      week_index: number;
      join_period: string;
      avg_lines_changed: number;
      avg_files_changed: number;
      contribution_count: number;
      contributor_count: number;
    }>;

    return rows.map(r => ({
      weekIndex: r.week_index,
      avgLinesChanged: r.avg_lines_changed ?? 0,
      avgFilesChanged: r.avg_files_changed ?? 0,
      contributionCount: r.contribution_count,
      contributorCount: r.contributor_count,
      joinPeriod: r.join_period,
    }));
  } else {
    // Normalized: per-org values first, then avg across orgs
    const perOrgRows = db.all(sql.raw(`
      SELECT
        org_id,
        week_index,
        join_period,
        AVG(avg_lines_changed) AS avg_lines_changed,
        AVG(avg_files_changed) AS avg_files_changed,
        SUM(contribution_count) AS contribution_count,
        SUM(contributor_count) AS contributor_count
      FROM ramp_up
      WHERE snapshot_id IN (${snapshotIds.join(',')})
      GROUP BY org_id, week_index, join_period
    `)) as Array<{
      org_id: number;
      week_index: number;
      join_period: string;
      avg_lines_changed: number;
      avg_files_changed: number;
      contribution_count: number;
      contributor_count: number;
    }>;

    const groups = new Map<string, typeof perOrgRows>();
    for (const row of perOrgRows) {
      const key = `${row.week_index}|${row.join_period}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }

    const result: RampUpBucket[] = [];
    for (const [key, groupRows] of groups) {
      const [weekStr, joinPeriod] = key.split('|');
      const n = groupRows.length;
      result.push({
        weekIndex: parseInt(weekStr, 10),
        avgLinesChanged: groupRows.reduce((s, r) => s + r.avg_lines_changed, 0) / n,
        avgFilesChanged: groupRows.reduce((s, r) => s + r.avg_files_changed, 0) / n,
        contributionCount: groupRows.reduce((s, r) => s + r.contribution_count, 0),
        contributorCount: groupRows.reduce((s, r) => s + r.contributor_count, 0),
        joinPeriod,
      });
    }

    result.sort((a, b) =>
      a.joinPeriod.localeCompare(b.joinPeriod) || a.weekIndex - b.weekIndex
    );

    return result;
  }
}

// ─── Org comparison table ─────────────────────────────────────────────────────

/**
 * Returns one summary row per org for side-by-side comparison.
 * Uses the latest snapshot per org.
 *
 * @param orgIds - list of org IDs to include
 */
export function getOrgComparisonTable(orgIds: number[]): OrgComparisonRow[] {
  if (orgIds.length === 0) return [];

  const snapshotMap = getLatestSnapshotIds(orgIds);

  // Get org metadata
  const orgRows = db.select().from(orgs).all().filter(o => orgIds.includes(o.id));

  // Get snapshot count per org
  const snapshotCounts = db.all(sql.raw(`
    SELECT org_id, COUNT(*) AS count
    FROM snapshots
    WHERE org_id IN (${orgIds.join(',')})
    GROUP BY org_id
  `)) as Array<{ org_id: number; count: number }>;

  const snapshotCountMap = new Map(snapshotCounts.map(r => [r.org_id, r.count]));

  const result: OrgComparisonRow[] = [];

  for (const org of orgRows) {
    const latestSnapshotId = snapshotMap.get(org.id);

    // Get latest snapshot metadata
    let snapshotRow: { contributor_count: number | null; repo_count: number | null; ai_marker_date: string | null } | undefined;
    if (latestSnapshotId !== undefined) {
      snapshotRow = db.all(sql.raw(`
        SELECT contributor_count, repo_count, ai_marker_date
        FROM snapshots
        WHERE id = ${latestSnapshotId}
      `))[0] as typeof snapshotRow;
    }

    // Get avg commit size from cohort_metrics (latest snapshot)
    let avgCommitSize: number | null = null;
    if (latestSnapshotId !== undefined) {
      const sizeRow = db.all(sql.raw(`
        SELECT AVG(avg_lines_added) AS avg_commit_size
        FROM cohort_metrics
        WHERE snapshot_id = ${latestSnapshotId}
          AND metric_type = 'commits'
      `))[0] as { avg_commit_size: number | null } | undefined;
      avgCommitSize = sizeRow?.avg_commit_size ?? null;
    }

    // Get number of ramp-up weeks (max week_index + 1)
    let rampUpWeeks: number | null = null;
    if (latestSnapshotId !== undefined) {
      const rampRow = db.all(sql.raw(`
        SELECT MAX(week_index) + 1 AS ramp_up_weeks
        FROM ramp_up
        WHERE snapshot_id = ${latestSnapshotId}
      `))[0] as { ramp_up_weeks: number | null } | undefined;
      rampUpWeeks = rampRow?.ramp_up_weeks ?? null;
    }

    result.push({
      id: org.id,
      label: org.label,
      sizeCategory: org.sizeCategory,
      snapshotCount: snapshotCountMap.get(org.id) ?? 0,
      contributorCount: snapshotRow?.contributor_count ?? null,
      repoCount: snapshotRow?.repo_count ?? null,
      aiMarkerDate: snapshotRow?.ai_marker_date ?? null,
      avgCommitSize,
      rampUpWeeks,
    });
  }

  return result;
}
