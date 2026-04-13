/**
 * Tests that the research server operates without requiring GitHub auth.
 * The research tool has no dependency on Octokit, GitHub API, or collection modules.
 * All data comes from imported ExportBundle files.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('Research server - no auth required', () => {
  it('research server index.ts does NOT import octokit', () => {
    const indexPath = resolve(__dirname, '..', 'index.ts');
    const content = readFileSync(indexPath, 'utf-8');
    expect(content).not.toContain('@octokit');
    expect(content).not.toContain('octokit');
  });

  it('research server index.ts does NOT import collection modules', () => {
    const indexPath = resolve(__dirname, '..', 'index.ts');
    const content = readFileSync(indexPath, 'utf-8');
    expect(content).not.toContain('collection');
    expect(content).not.toContain('CollectionQueue');
  });

  it('research server index.ts does NOT import github modules', () => {
    const indexPath = resolve(__dirname, '..', 'index.ts');
    const content = readFileSync(indexPath, 'utf-8');
    expect(content).not.toContain('github');
    expect(content).not.toContain('GitHub');
  });

  it('GET /api/health returns 200 without auth headers', async () => {
    // Test using the Hono app directly (no server needed)
    const { app } = await import('../index.js');
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('ok');
  });

  it('GET /api/health does not require Authorization header', async () => {
    const { app } = await import('../index.js');
    // No Authorization header
    const res = await app.request('/api/health', {
      method: 'GET',
    });
    expect(res.status).toBe(200);
  });
});
