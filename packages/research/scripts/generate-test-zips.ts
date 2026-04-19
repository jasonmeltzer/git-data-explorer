/**
 * Generate realistic test ZIP bundles for the research tool.
 *
 * Produces 3 ZIP files matching the exact format the main app's ExportModal creates:
 *   - small-startup.zip   (8 contributors, fast AI ramp-up)
 *   - mid-size-company.zip (80 contributors, gradual AI adoption)
 *   - pre-ai-baseline.zip  (40 contributors, no AI marker — control group)
 *
 * Usage:
 *   npx tsx packages/research/scripts/generate-test-zips.ts
 *   npx tsx packages/research/scripts/generate-test-zips.ts --out /tmp/bundles
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { generateAllTestOrgs } from '../server/services/test-data-generator.js';
import type { ExportBundle } from '@shared/export-types.js';

function bundleToZip(bundle: ExportBundle): Uint8Array {
  const json = (data: unknown) => strToU8(JSON.stringify(data, null, 2));

  const files: Record<string, Uint8Array> = {
    'metadata.json': json(bundle.metadata),
    'cohort-commits.json': json(bundle.cohortCommits),
    'cohort-prs.json': json(bundle.cohortPrs),
    'ramp-up.json': json(bundle.rampUp),
    'contributors.json': json(bundle.contributors),
    'pr-turnaround.json': json(bundle.prTurnaround),
    'bot-ratio.json': json(bundle.botRatio),
  };

  if (bundle.rolling) {
    files['rolling-comparison.json'] = json(bundle.rolling);
  }
  if (bundle.executiveSummary) {
    files['executive-summary.json'] = json(bundle.executiveSummary);
  }
  if (bundle.periodMetrics) {
    files['period-metrics.json'] = json(bundle.periodMetrics);
  }
  if (bundle.concentrationMonthly.length > 0) {
    files['concentration-monthly.json'] = json(bundle.concentrationMonthly);
  }
  if (bundle.headcountMonthly.length > 0) {
    files['headcount-monthly.json'] = json(bundle.headcountMonthly);
  }

  return zipSync(files);
}

// Parse --out flag
const outIdx = process.argv.indexOf('--out');
const outDir = outIdx !== -1 && process.argv[outIdx + 1]
  ? resolve(process.argv[outIdx + 1])
  : resolve(process.cwd(), 'data', 'test-bundles');

mkdirSync(outDir, { recursive: true });

const testOrgs = generateAllTestOrgs();

const slugs = ['small-startup', 'mid-size-company', 'pre-ai-baseline'];

for (let i = 0; i < testOrgs.length; i++) {
  const { label, bundle } = testOrgs[i];
  const zip = bundleToZip(bundle);
  const filename = `${slugs[i]}.zip`;
  const filepath = resolve(outDir, filename);
  writeFileSync(filepath, zip);

  const sections = Object.entries(bundle).filter(([, v]) => v != null && (!Array.isArray(v) || v.length > 0)).length;
  console.log(`  ${filename} (${(zip.length / 1024).toFixed(1)} KB, ${sections} sections) — ${label}`);
}

console.log(`\n${testOrgs.length} ZIP bundles written to ${outDir}`);
console.log('\nTo test:');
console.log('  1. npm run research');
console.log('  2. Open http://localhost:5174');
console.log('  3. Import each ZIP via the "Local File" tab');
console.log('  4. Navigate to Cross-Org page and select all 3 orgs');
