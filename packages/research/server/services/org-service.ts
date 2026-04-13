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
import { eq } from 'drizzle-orm';

export function createOrg(label: string, importSource: string, sizeCategory?: string): number {
  const result = db
    .insert(orgs)
    .values({
      label,
      importSource,
      sizeCategory: sizeCategory ?? null,
      createdAt: Date.now(),
    })
    .returning({ id: orgs.id })
    .get();
  return result.id;
}

export function listOrgs() {
  return db.select().from(orgs).all();
}

export function getOrg(id: number) {
  return db.select().from(orgs).where(eq(orgs.id, id)).get();
}

export function updateOrg(
  id: number,
  data: { label?: string; sizeCategory?: string }
) {
  db.update(orgs).set(data).where(eq(orgs.id, id)).run();
}

export function deleteOrg(id: number) {
  db.transaction(() => {
    const orgSnapshots = db
      .select({ id: snapshots.id })
      .from(snapshots)
      .where(eq(snapshots.orgId, id))
      .all();
    for (const s of orgSnapshots) {
      deleteSnapshotData(s.id);
    }
    db.delete(snapshots).where(eq(snapshots.orgId, id)).run();
    db.delete(orgs).where(eq(orgs.id, id)).run();
  });
}

export function deleteSnapshotData(snapshotId: number) {
  db.delete(cohortMetrics).where(eq(cohortMetrics.snapshotId, snapshotId)).run();
  db.delete(rampUp).where(eq(rampUp.snapshotId, snapshotId)).run();
  db.delete(rollingComparisons).where(eq(rollingComparisons.snapshotId, snapshotId)).run();
  db.delete(contributors).where(eq(contributors.snapshotId, snapshotId)).run();
  db.delete(prTurnaround).where(eq(prTurnaround.snapshotId, snapshotId)).run();
  db.delete(botRatio).where(eq(botRatio.snapshotId, snapshotId)).run();
}

export function deleteSnapshot(snapshotId: number) {
  deleteSnapshotData(snapshotId);
  db.delete(snapshots).where(eq(snapshots.id, snapshotId)).run();
}

export function getSnapshotsForOrg(orgId: number) {
  return db.select().from(snapshots).where(eq(snapshots.orgId, orgId)).all();
}
