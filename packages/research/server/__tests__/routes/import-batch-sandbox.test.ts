/**
 * Route-level regression tests for POST /api/import/batch path-sandbox enforcement.
 * Verifies that sandboxPath guards are wired at the route boundary so CI fails loudly
 * on any regression (path escape, symlink escape, unset base dir).
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Mock the import-service so no real file-system scanning happens for the success case
vi.mock('../../services/import-service.js', () => ({
  importBundle: vi.fn().mockReturnValue({ orgId: 1, snapshotId: 1, warnings: [], isDuplicate: false }),
  importFromUrl: vi.fn().mockResolvedValue({}),
  importFromDirectory: vi.fn().mockReturnValue([]),
  parseZipBundle: vi.fn().mockReturnValue({}),
}));

let app: Hono;
let tmpBase: string;
let baseDir: string;
let outsideDir: string;
const originalEnv = process.env.RESEARCH_IMPORT_BASE_DIR;

beforeAll(async () => {
  // Canonicalize via realpathSync to handle macOS /var -> /private/var aliasing
  tmpBase = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'batch-sandbox-test-')));
  baseDir = path.join(tmpBase, 'imports');
  outsideDir = path.join(tmpBase, 'evil-target');

  fs.mkdirSync(baseDir);
  fs.mkdirSync(path.join(baseDir, 'sub'));
  fs.mkdirSync(outsideDir);

  // Create a symlink inside baseDir that escapes to outsideDir
  fs.symlinkSync(outsideDir, path.join(baseDir, 'link'));

  process.env.RESEARCH_IMPORT_BASE_DIR = baseDir;

  const { default: importRoutes } = await import('../../routes/import.js');
  app = new Hono();
  app.route('/', importRoutes);
});

afterAll(() => {
  fs.rmSync(tmpBase, { recursive: true, force: true });
  if (originalEnv === undefined) {
    delete process.env.RESEARCH_IMPORT_BASE_DIR;
  } else {
    process.env.RESEARCH_IMPORT_BASE_DIR = originalEnv;
  }
});

async function postBatch(directoryPath: string) {
  return app.request('/api/import/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ directoryPath }),
  });
}

describe('POST /api/import/batch — path sandbox enforcement', () => {
  it('1. .. traversal is rejected with 400', async () => {
    const res = await postBatch('../outside');
    expect(res.status).toBe(400);
    const body = await res.json() as { success: boolean; errors: string[] };
    expect(body.success).toBe(false);
    expect(body.errors.join(',')).toMatch(/path_escapes_base|path_does_not_exist/);
  });

  it('2. absolute path outside base (/etc) is rejected with 400', async () => {
    const res = await postBatch('/etc');
    expect(res.status).toBe(400);
    const body = await res.json() as { success: boolean; errors: string[] };
    expect(body.success).toBe(false);
    expect(body.errors.join(',')).toContain('path_escapes_base');
  });

  it('3. symlink that escapes base is rejected with 400', async () => {
    const res = await postBatch('link');
    expect(res.status).toBe(400);
    const body = await res.json() as { success: boolean; errors: string[] };
    expect(body.success).toBe(false);
    expect(body.errors.join(',')).toContain('path_escapes_base');
  });

  it('4. valid subdirectory inside base returns 200 with empty results', async () => {
    const res = await postBatch('sub');
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; results: unknown[] };
    expect(body.success).toBe(true);
    expect(Array.isArray(body.results)).toBe(true);
  });
});

describe('POST /api/import/batch — unset RESEARCH_IMPORT_BASE_DIR', () => {
  it('5. unset base env returns 400 with base_dir_not_configured', async () => {
    const saved = process.env.RESEARCH_IMPORT_BASE_DIR;
    delete process.env.RESEARCH_IMPORT_BASE_DIR;
    try {
      const res = await postBatch('sub');
      expect(res.status).toBe(400);
      const body = await res.json() as { success: boolean; errors: string[] };
      expect(body.success).toBe(false);
      expect(body.errors.join(',')).toContain('base_dir_not_configured');
    } finally {
      process.env.RESEARCH_IMPORT_BASE_DIR = saved;
    }
  });
});
