import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { db } from '../db/client.js';
import { safeFetch } from './safe-fetch.js';
import {
  orgs,
  snapshots,
  cohortMetrics,
  rampUp,
  rollingComparisons,
  contributors,
  prTurnaround,
  botRatio,
  concentrationMonthly,
  headcountMonthly,
  periodMetrics,
} from '../db/schema.js';
import { eq, and, ne } from 'drizzle-orm';
import { validateBundle } from './validation.js';
import { createOrg } from './org-service.js';

export type ImportSource = 'file' | 'gist' | 'url' | 'batch';

export interface CrossOrgDuplicate {
  otherOrgName: string;
  importedAt: string; // ISO date string (YYYY-MM-DD)
}

export interface FuzzyMatch {
  otherOrgName: string;
  overlapReason: string;
  importedAt: string; // ISO date string (YYYY-MM-DD)
}

export interface ImportResult {
  orgId: number;
  snapshotId: number;
  warnings: string[];
  isDuplicate: boolean;
  crossOrgDuplicate?: CrossOrgDuplicate;
  fuzzyMatch?: FuzzyMatch;
}

/**
 * Parse a ZIP buffer containing an ExportBundle.
 * The ZIP contains individual JSON files (metadata.json, cohort-commits.json, etc.)
 * that were created by the ExportModal client component.
 */
export function parseZipBundle(buffer: Buffer): unknown {
  const uint8 = new Uint8Array(buffer);
  const unzipped = unzipSync(uint8);

  const readJson = (filename: string): unknown => {
    const data = unzipped[filename];
    if (!data) return null;
    return JSON.parse(strFromU8(data));
  };

  const metadata = readJson('metadata.json');
  if (!metadata) {
    throw new Error('ZIP bundle missing required metadata.json');
  }

  return {
    metadata,
    cohortCommits: readJson('cohort-commits.json') ?? [],
    cohortPrs: readJson('cohort-prs.json') ?? [],
    rampUp: readJson('ramp-up.json') ?? [],
    rolling: readJson('rolling-comparison.json') ?? null,
    contributors: readJson('contributors.json') ?? [],
    prTurnaround: readJson('pr-turnaround.json') ?? [],
    botRatio: readJson('bot-ratio.json') ?? [],
    executiveSummary: readJson('executive-summary.json') ?? null,
    periodMetrics: readJson('period-metrics.json') ?? null,
    concentrationMonthly: readJson('concentration-monthly.json') ?? [],
    headcountMonthly: readJson('headcount-monthly.json') ?? [],
  };
}

/**
 * Import a bundle object into the research database.
 * Creates an org if orgId is null. Returns orgId, snapshotId, warnings, isDuplicate.
 */
export function importBundle(
  bundle: unknown,
  orgId: number | null,
  importSource: ImportSource,
  orgLabel?: string,
): ImportResult {
  const validation = validateBundle(bundle);
  if (!validation.valid || !validation.data) {
    throw new Error(`Invalid bundle: ${validation.errors?.join('; ')}`);
  }

  const data = validation.data;
  const warnings = [...validation.warnings];

  // Compute content hash for dedup detection (use Zod-normalized data, not raw bundle,
  // so bundles with missing-but-defaulted optional arrays hash consistently — WR-02)
  const contentHash = createHash('sha256').update(JSON.stringify(data)).digest('hex');

  // Derived counts (computed early for org size inference)
  const contributorCount = new Set(data.contributors.map((c) => c.authorLogin)).size;
  const repoCount = data.metadata.repoNames.length;

  // Auto-create org if needed — but first, check whether this exact bundle
  // (by contentHash) has already been imported into ANY existing org. If so,
  // attach as a new snapshot on that org instead of creating a duplicate org.
  // This matches user expectation: re-importing the same ZIP should add a new
  // snapshot, not spawn a parallel org. (Filed 2026-04-18 smoke test §3f.)
  if (orgId === null) {
    const existingSnapshot = db
      .select({ orgId: snapshots.orgId })
      .from(snapshots)
      .where(eq(snapshots.contentHash, contentHash))
      .limit(1)
      .get();

    if (existingSnapshot) {
      orgId = existingSnapshot.orgId;
      warnings.push('Content matches an existing org — attaching as a new snapshot');
    } else {
      const label =
        orgLabel ??
        data.metadata.orgName ??   // D-11: prefer orgName from metadata
        (repoCount > 0
          ? `${data.metadata.repoNames[0]}${repoCount > 1 ? ` (+${repoCount - 1} more)` : ''}`
          : `Import-${new Date().toISOString().slice(0, 10)}`);
      const size = contributorCount <= 20 ? 'small' : contributorCount <= 100 ? 'medium' : 'large';
      orgId = createOrg(label, importSource, size);
    }
  }

  // Check for duplicate (same contentHash for this org) — single indexed query (WR-01)
  const sameOrgMatch = db
    .select({ id: snapshots.id })
    .from(snapshots)
    .where(and(eq(snapshots.orgId, orgId), eq(snapshots.contentHash, contentHash)))
    .limit(1)
    .get();
  const isDuplicate = !!sameOrgMatch;
  if (isDuplicate) {
    warnings.push('Duplicate bundle detected (same content hash) — importing as new snapshot anyway');
  }

  // Cross-org exact hash match — find ANY snapshot in a DIFFERENT org with same contentHash
  let crossOrgDuplicate: CrossOrgDuplicate | undefined;
  const crossOrgExact = db
    .select({
      orgId: snapshots.orgId,
      importTimestamp: snapshots.importTimestamp,
    })
    .from(snapshots)
    .where(
      and(
        eq(snapshots.contentHash, contentHash),
        ne(snapshots.orgId, orgId as number)
      )
    )
    .limit(1)
    .get();

  if (crossOrgExact) {
    const otherOrg = db.select({ label: orgs.label }).from(orgs).where(eq(orgs.id, crossOrgExact.orgId)).get();
    crossOrgDuplicate = {
      otherOrgName: otherOrg?.label ?? `org ${crossOrgExact.orgId}`,
      importedAt: new Date(crossOrgExact.importTimestamp).toISOString().split('T')[0],
    };
    warnings.push(`This bundle was already imported to '${crossOrgDuplicate.otherOrgName}' on ${crossOrgDuplicate.importedAt}`);
  }

  // Fuzzy match: overlapping owners + repoIds + date range in a DIFFERENT org
  // Per D-05, both exact and fuzzy fire independently
  let fuzzyMatch: FuzzyMatch | undefined;
  const bundleRepoIds = new Set(data.metadata.repoIds);
  const bundleStart = data.metadata.startDate;
  const bundleEnd = data.metadata.endDate;

  // Parse owner from repoNames for owner-based matching
  const bundleOwners = new Set(
    data.metadata.repoNames.map((name: string) => name.split('/')[0]).filter(Boolean)
  );

  // Get all snapshots from OTHER orgs
  const otherSnapshots = db
    .select({
      id: snapshots.id,
      orgId: snapshots.orgId,
      metadataJson: snapshots.metadataJson,
      importTimestamp: snapshots.importTimestamp,
      startDate: snapshots.startDate,
      endDate: snapshots.endDate,
    })
    .from(snapshots)
    .where(ne(snapshots.orgId, orgId as number))
    .all();

  for (const snap of otherSnapshots) {
    if (fuzzyMatch) break; // take first fuzzy match only
    try {
      const meta = JSON.parse(snap.metadataJson);
      const snapRepoIds = new Set(meta.repoIds ?? []);
      const snapOwners = new Set(
        (meta.repoNames ?? []).map((n: string) => n.split('/')[0]).filter(Boolean)
      );

      // Check overlapping owners
      const ownerOverlap = [...bundleOwners].some((o) => snapOwners.has(o));
      if (!ownerOverlap) continue;

      // Check overlapping repoIds
      const repoOverlap = [...bundleRepoIds].some((id) => snapRepoIds.has(id));
      if (!repoOverlap) continue;

      // Check overlapping date range — numeric comparison for format safety (WR-03)
      const toMs = (s: string) => new Date(s).getTime();
      const snapStartMs = toMs(snap.startDate ?? meta.startDate);
      const snapEndMs = toMs(snap.endDate ?? meta.endDate);
      const bundleStartMs = toMs(bundleStart);
      const bundleEndMs = toMs(bundleEnd);
      const allValid = [snapStartMs, snapEndMs, bundleStartMs, bundleEndMs].every(n => !Number.isNaN(n));
      const dateOverlap = allValid && bundleStartMs <= snapEndMs && bundleEndMs >= snapStartMs;
      if (!dateOverlap) continue;

      const otherOrg = db.select({ label: orgs.label }).from(orgs).where(eq(orgs.id, snap.orgId)).get();
      fuzzyMatch = {
        otherOrgName: otherOrg?.label ?? `org ${snap.orgId}`,
        overlapReason: 'Overlapping repos and date range',
        importedAt: new Date(snap.importTimestamp).toISOString().split('T')[0],
      };
      warnings.push(`Similar data found in '${fuzzyMatch.otherOrgName}' (imported ${fuzzyMatch.importedAt}) — overlapping repos and date range`);
    } catch {
      // Skip snapshots with unparseable metadata
    }
  }

  // All inserts in a single transaction
  const snapshotId = db.transaction(() => {
    const snap = db
      .insert(snapshots)
      .values({
        orgId: orgId as number,
        importTimestamp: Date.now(),
        metadataJson: JSON.stringify(data.metadata),
        toolVersion: data.metadata.toolVersion,
        startDate: data.metadata.startDate,
        endDate: data.metadata.endDate,
        aiMarkerDate: data.metadata.aiMarkerDate,
        contributorCount,
        repoCount,
        contentHash,
        executiveSummaryJson: data.executiveSummary
          ? JSON.stringify(data.executiveSummary)
          : null,
      })
      .returning({ id: snapshots.id })
      .get();

    const snapId = snap.id;

    // Insert cohort_metrics rows
    if (data.cohortCommits.length > 0) {
      db.insert(cohortMetrics)
        .values(
          data.cohortCommits.map((row) => ({
            snapshotId: snapId,
            orgId: orgId as number,
            metricType: 'commits' as const,
            cohort: row.cohort,
            period: row.period,
            periodMonth: row.periodMonth,
            avgLinesAdded: row.avgLinesAdded,
            avgLinesDeleted: row.avgLinesDeleted,
            avgFilesChanged: row.avgFilesChanged,
            totalCount: row.totalCount,
            contributorCount: row.contributorCount,
          }))
        )
        .run();
    }

    if (data.cohortPrs.length > 0) {
      db.insert(cohortMetrics)
        .values(
          data.cohortPrs.map((row) => ({
            snapshotId: snapId,
            orgId: orgId as number,
            metricType: 'prs' as const,
            cohort: row.cohort,
            period: row.period,
            periodMonth: row.periodMonth,
            avgLinesAdded: row.avgLinesAdded,
            avgLinesDeleted: row.avgLinesDeleted,
            avgFilesChanged: row.avgFilesChanged,
            totalCount: row.totalCount,
            contributorCount: row.contributorCount,
          }))
        )
        .run();
    }

    // Insert ramp_up rows
    if (data.rampUp.length > 0) {
      db.insert(rampUp)
        .values(
          data.rampUp.map((row) => ({
            snapshotId: snapId,
            orgId: orgId as number,
            weekIndex: row.weekIndex,
            avgLinesChanged: row.avgLinesChanged,
            avgFilesChanged: row.avgFilesChanged,
            contributionCount: row.contributionCount,
            contributorCount: row.contributorCount,
            joinPeriod: row.joinPeriod,
          }))
        )
        .run();
    }

    // Insert rolling_comparisons row (single JSON blob)
    if (data.rolling !== null) {
      db.insert(rollingComparisons)
        .values({
          snapshotId: snapId,
          orgId: orgId as number,
          dataJson: JSON.stringify(data.rolling),
        })
        .run();
    }

    // Insert contributors rows
    if (data.contributors.length > 0) {
      db.insert(contributors)
        .values(
          data.contributors.map((row) => ({
            snapshotId: snapId,
            orgId: orgId as number,
            authorLogin: row.authorLogin,
            cohort: row.cohort,
            firstCommitAt: row.firstCommitAt ?? null,
            preJson: row.pre ? JSON.stringify(row.pre) : null,
            postJson: row.post ? JSON.stringify(row.post) : null,
          }))
        )
        .run();
    }

    // Insert pr_turnaround rows
    if (data.prTurnaround.length > 0) {
      db.insert(prTurnaround)
        .values(
          data.prTurnaround.map((row) => ({
            snapshotId: snapId,
            orgId: orgId as number,
            periodMonth: row.periodMonth,
            avgHoursToMerge: row.avgHoursToMerge,
            medianHoursToMerge: row.medianHoursToMerge,
            prCount: row.prCount,
          }))
        )
        .run();
    }

    // Insert bot_ratio rows
    if (data.botRatio.length > 0) {
      db.insert(botRatio)
        .values(
          data.botRatio.map((row) => ({
            snapshotId: snapId,
            orgId: orgId as number,
            periodMonth: row.periodMonth,
            botCommits: row.botCommits,
            humanCommits: row.humanCommits,
            totalCommits: row.totalCommits,
            botPercentage: row.botPercentage,
          }))
        )
        .run();
    }

    // Insert concentration_monthly rows
    if (data.concentrationMonthly?.length) {
      for (const row of data.concentrationMonthly) {
        db.insert(concentrationMonthly).values({
          snapshotId: snapId,
          orgId: orgId as number,
          basis: row.basis,
          periodMonth: row.month,
          top1Share: row.top1Share ?? null,
          top3Share: row.top3Share ?? null,
          top5Share: row.top5Share ?? null,
          hhi: row.hhi ?? null,
          gini: row.gini ?? null,
          busFactor: row.busFactor ?? null,
          activeDevs: row.activeDevs,
          topContributor: row.topContributor ?? null,
        }).run();
      }
    }

    // Insert headcount_monthly rows
    if (data.headcountMonthly?.length) {
      for (const row of data.headcountMonthly) {
        db.insert(headcountMonthly).values({
          snapshotId: snapId,
          orgId: orgId as number,
          periodMonth: row.month,
          activeDevs: row.activeDevs,
          totalPrs: row.totalPrs,
          totalCommits: row.totalCommits,
          prsPerDev: row.prsPerDev ?? null,
          commitsPerDev: row.commitsPerDev ?? null,
        }).run();
      }
    }

    // Insert period_metrics row (single JSON blob per snapshot)
    if (data.periodMetrics?.length) {
      db.insert(periodMetrics).values({
        snapshotId: snapId,
        orgId: orgId as number,
        dataJson: JSON.stringify(data.periodMetrics),
      }).run();
    }

    return snapId;
  });

  return {
    orgId: orgId as number,
    snapshotId,
    warnings,
    isDuplicate,
    ...(crossOrgDuplicate && { crossOrgDuplicate }),
    ...(fuzzyMatch && { fuzzyMatch }),
  };
}

/**
 * Fetch a bundle from a URL (Gist URL or plain HTTP URL).
 * Returns parsed raw JSON object (not yet validated).
 */
export async function importFromUrl(
  url: string,
  source: 'gist' | 'url'
): Promise<unknown> {
  let fetchUrl = url;

  // Detect Gist URLs and convert to raw content API URL
  // e.g. https://gist.github.com/user/abc123 -> https://api.github.com/gists/abc123
  if (source === 'gist') {
    const gistMatch = url.match(/gist\.github\.com\/[^/]+\/([a-f0-9]+)/i);
    if (gistMatch) {
      const gistId = gistMatch[1];
      // Fetch the Gist API to get the raw URL for the first file
      const apiRes = await safeFetch(`https://api.github.com/gists/${gistId}`, 3, {
        headers: { Accept: 'application/vnd.github.v3+json' },
      });
      if (!apiRes.ok) {
        throw new Error(`Failed to fetch Gist metadata: HTTP ${apiRes.status}`);
      }
      const gistData = await apiRes.json() as { files: Record<string, { raw_url: string }> };
      const fileKeys = Object.keys(gistData.files);
      if (fileKeys.length === 0) {
        throw new Error('Gist has no files');
      }
      // Look for a .json file, or use the first file
      const jsonFile = fileKeys.find((k) => k.endsWith('.json')) ?? fileKeys[0];
      fetchUrl = gistData.files[jsonFile].raw_url;
    }
  }

  const res = await safeFetch(fetchUrl);
  if (!res.ok) {
    throw new Error(`Failed to fetch bundle from URL: HTTP ${res.status}`);
  }

  const contentType = res.headers.get('content-type') ?? '';

  // Handle ZIP responses
  if (contentType.includes('zip') || fetchUrl.endsWith('.zip')) {
    const buf = Buffer.from(await res.arrayBuffer());
    return parseZipBundle(buf);
  }

  return res.json();
}

/**
 * Import all .json and .zip bundle files from a directory.
 * Returns array of import results (one per file).
 */
export function importFromDirectory(
  dirPath: string
): Array<ImportResult & { file: string; error?: string }> {
  const files = fs.readdirSync(dirPath).filter(
    (f) => f.endsWith('.json') || f.endsWith('.zip')
  );

  const results: Array<ImportResult & { file: string; error?: string }> = [];

  for (const file of files) {
    const filePath = path.join(dirPath, file);
    try {
      let bundle: unknown;
      if (file.endsWith('.zip')) {
        const buf = fs.readFileSync(filePath);
        bundle = parseZipBundle(buf);
      } else {
        const content = fs.readFileSync(filePath, 'utf8');
        bundle = JSON.parse(content);
      }
      const result = importBundle(bundle, null, 'batch');
      results.push({ ...result, file });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      results.push({
        orgId: -1,
        snapshotId: -1,
        warnings: [],
        isDuplicate: false,
        file,
        error,
      });
    }
  }

  return results;
}
