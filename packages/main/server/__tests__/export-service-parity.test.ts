/**
 * Doc-code parity test (DOC-01).
 *
 * If a future developer adds or removes a field in packages/shared/export-types.ts
 * ExportBundle without updating the "N dashboard data sections" comment in
 * packages/main/server/services/export-service.ts, this test fails.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExportBundle } from '@shared/export-types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('export-service.ts doc-code parity (DOC-01)', () => {
  it('documented section count matches ExportBundle non-metadata field count', () => {
    const servicePath = path.resolve(__dirname, '..', 'services', 'export-service.ts');
    const source = fs.readFileSync(servicePath, 'utf8');
    const match = source.match(/Aggregates all (\d+) dashboard data sections/);
    expect(match, 'Could not find "Aggregates all N dashboard data sections" comment').toBeTruthy();
    const documentedCount = parseInt(match![1], 10);

    const synthetic: ExportBundle = {
      metadata: {} as never,
      cohortCommits: [],
      cohortPrs: [],
      rampUp: [],
      rolling: null,
      contributors: [],
      prTurnaround: [],
      botRatio: [],
      executiveSummary: null,
      periodMetrics: null,
      concentrationMonthly: [],
      headcountMonthly: [],
      developerMonthly: [],   // Phase 9.5-01 — type-skeleton stub
    };
    const actualCount = Object.keys(synthetic).filter((k) => k !== 'metadata').length;

    expect(documentedCount).toBe(actualCount);
  });
});
