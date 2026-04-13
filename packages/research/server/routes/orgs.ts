import { Hono } from 'hono';
import { db } from '../db/client.js';
import {
  orgs,
  snapshots,
  cohortMetrics,
  rampUp,
  rollingComparisons,
  contributors,
  prTurnaround,
  botRatio,
} from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import {
  listOrgs,
  getOrg,
  updateOrg,
  deleteOrg,
  deleteSnapshot,
  getSnapshotsForOrg,
} from '../services/org-service.js';

const orgRoutes = new Hono();

/**
 * GET /api/orgs
 * List all orgs with their snapshot counts.
 */
orgRoutes.get('/api/orgs', (c) => {
  const all = db
    .select({
      id: orgs.id,
      label: orgs.label,
      sizeCategory: orgs.sizeCategory,
      industry: orgs.industry,
      aiTool: orgs.aiTool,
      importSource: orgs.importSource,
      createdAt: orgs.createdAt,
      snapshotCount: sql<number>`COUNT(${snapshots.id})`,
    })
    .from(orgs)
    .leftJoin(snapshots, eq(snapshots.orgId, orgs.id))
    .groupBy(orgs.id)
    .all();
  return c.json(all);
});

/**
 * GET /api/orgs/:id
 * Get org details with its snapshots.
 */
orgRoutes.get('/api/orgs/:id', (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) {
    return c.json({ error: 'Invalid org id' }, 400);
  }
  const org = getOrg(id);
  if (!org) {
    return c.json({ error: 'Org not found' }, 404);
  }
  const orgSnapshots = getSnapshotsForOrg(id);
  return c.json({ ...org, snapshots: orgSnapshots });
});

/**
 * PATCH /api/orgs/:id
 * Update org metadata.
 */
orgRoutes.patch('/api/orgs/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) {
    return c.json({ error: 'Invalid org id' }, 400);
  }
  const body = await c.req.json().catch(() => null);
  if (!body) {
    return c.json({ error: 'Request body required' }, 400);
  }
  updateOrg(id, {
    label: typeof body.label === 'string' ? body.label : undefined,
    sizeCategory: typeof body.sizeCategory === 'string' ? body.sizeCategory : undefined,
    industry: typeof body.industry === 'string' ? body.industry : undefined,
    aiTool: typeof body.aiTool === 'string' ? body.aiTool : undefined,
  });
  return c.json({ success: true });
});

/**
 * DELETE /api/orgs/:id
 * Delete org and all its snapshots.
 */
orgRoutes.delete('/api/orgs/:id', (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) {
    return c.json({ error: 'Invalid org id' }, 400);
  }
  deleteOrg(id);
  return c.json({ success: true });
});

/**
 * DELETE /api/orgs/:orgId/snapshots/:snapshotId
 * Delete a single snapshot (and all its data rows).
 */
orgRoutes.delete('/api/orgs/:orgId/snapshots/:snapshotId', (c) => {
  const snapshotId = parseInt(c.req.param('snapshotId'), 10);
  if (isNaN(snapshotId)) {
    return c.json({ error: 'Invalid snapshot id' }, 400);
  }
  deleteSnapshot(snapshotId);
  return c.json({ success: true });
});

/**
 * GET /api/orgs/:orgId/snapshots/:snapshotId/data
 * Reconstruct an ExportBundle-like object from relational tables for dashboard rendering.
 */
orgRoutes.get('/api/orgs/:orgId/snapshots/:snapshotId/data', (c) => {
  const orgId = parseInt(c.req.param('orgId'), 10);
  const snapshotId = parseInt(c.req.param('snapshotId'), 10);
  if (isNaN(orgId) || isNaN(snapshotId)) {
    return c.json({ error: 'Invalid org or snapshot id' }, 400);
  }

  const snapshot = db
    .select()
    .from(snapshots)
    .where(eq(snapshots.id, snapshotId))
    .get();
  if (!snapshot || snapshot.orgId !== orgId) {
    return c.json({ error: 'Snapshot not found' }, 404);
  }

  // Load all sections from relational tables
  const commits = db
    .select()
    .from(cohortMetrics)
    .where(eq(cohortMetrics.snapshotId, snapshotId))
    .all();

  const rampUpRows = db
    .select()
    .from(rampUp)
    .where(eq(rampUp.snapshotId, snapshotId))
    .all();

  const rollingRow = db
    .select()
    .from(rollingComparisons)
    .where(eq(rollingComparisons.snapshotId, snapshotId))
    .get();

  const contributorRows = db
    .select()
    .from(contributors)
    .where(eq(contributors.snapshotId, snapshotId))
    .all();

  const prTurnaroundRows = db
    .select()
    .from(prTurnaround)
    .where(eq(prTurnaround.snapshotId, snapshotId))
    .all();

  const botRatioRows = db
    .select()
    .from(botRatio)
    .where(eq(botRatio.snapshotId, snapshotId))
    .all();

  // Reconstruct ExportBundle-like object
  const bundle = {
    metadata: JSON.parse(snapshot.metadataJson),
    cohortCommits: commits
      .filter((r) => r.metricType === 'commits')
      .map(({ metricType: _m, id: _id, snapshotId: _s, orgId: _o, ...rest }) => rest),
    cohortPrs: commits
      .filter((r) => r.metricType === 'prs')
      .map(({ metricType: _m, id: _id, snapshotId: _s, orgId: _o, ...rest }) => rest),
    rampUp: rampUpRows.map(({ id: _id, snapshotId: _s, orgId: _o, ...rest }) => rest),
    rolling: rollingRow ? JSON.parse(rollingRow.dataJson) : null,
    contributors: contributorRows.map((r) => ({
      authorLogin: r.authorLogin,
      cohort: r.cohort,
      firstCommitAt: r.firstCommitAt,
      pre: r.preJson ? JSON.parse(r.preJson) : null,
      post: r.postJson ? JSON.parse(r.postJson) : null,
    })),
    prTurnaround: prTurnaroundRows.map(({ id: _id, snapshotId: _s, orgId: _o, ...rest }) => rest),
    botRatio: botRatioRows.map(({ id: _id, snapshotId: _s, orgId: _o, ...rest }) => rest),
    executiveSummary: snapshot.executiveSummaryJson
      ? JSON.parse(snapshot.executiveSummaryJson)
      : null,
    beforeAfter: snapshot.beforeAfterJson ? JSON.parse(snapshot.beforeAfterJson) : null,
  };

  return c.json(bundle);
});

export default orgRoutes;
