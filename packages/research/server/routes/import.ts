import { Hono } from 'hono';
import { z } from 'zod';
import {
  importBundle,
  importFromUrl,
  importFromDirectory,
  parseZipBundle,
} from '../services/import-service.js';
import { isSafeUrl, resolveAndValidateHost } from '../services/url-safety.js';
import { sandboxPath } from '../services/path-safety.js';

const importRoutes = new Hono();

const UrlImportBody = z.object({
  url: z.string().url(),
  orgId: z.number().int().positive().optional(),
  orgLabel: z.string().min(1).max(200).optional(),
});

/**
 * POST /api/import/file — UNCHANGED from pre-09.4.3 (no URL / path user input).
 */
importRoutes.post('/api/import/file', async (c) => {
  try {
    const body = await c.req.parseBody();
    const file = body['file'];

    if (!file || typeof file === 'string') {
      return c.json({ success: false, errors: ['No file provided in form data'] }, 400);
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const filename = file.name ?? 'upload';

    let bundle: unknown;
    if (filename.endsWith('.zip') || file.type === 'application/zip') {
      bundle = parseZipBundle(buffer);
    } else {
      // Assume JSON
      bundle = JSON.parse(buffer.toString('utf8'));
    }

    const result = importBundle(bundle, null, 'file');
    return c.json({ success: true, ...result });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return c.json({ success: false, errors: [error] }, 400);
  }
});

/**
 * POST /api/import/url
 * Three-layer SSRF defense: (1) isSafeUrl pre-DNS string check, (2) resolveAndValidateHost
 * DNS all-records check, (3) ssrfSafeAgent connect-hook re-validation inside safeFetch.
 */
importRoutes.post('/api/import/url', async (c) => {
  const parsed = UrlImportBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ success: false, errors: parsed.error.issues.map((i) => i.message) }, 400);
  }
  const { url, orgId, orgLabel } = parsed.data;

  // Layer 1: pre-DNS string check (rejects non-https, IP literals, localhost aliases, credentials)
  const urlCheck = isSafeUrl(url);
  if (!urlCheck.ok) {
    return c.json({ success: false, errors: [`rejected:${urlCheck.reason}`] }, 400);
  }

  // Layer 2: DNS all-records check (rejects private/blocked resolved IPs)
  try {
    await resolveAndValidateHost(urlCheck.url.hostname);
  } catch (e) {
    const reason = e instanceof Error ? e.message : 'dns_error';
    return c.json({ success: false, errors: [`rejected:${reason}`] }, 400);
  }

  try {
    // Layer 3: safeFetch inside importFromUrl uses undici ssrfSafeAgent (connect-hook)
    const source = url.includes('gist.github.com') ? 'gist' : 'url';
    const bundle = await importFromUrl(url, source);
    const result = importBundle(bundle, orgId ?? null, source, orgLabel);
    return c.json({ success: true, ...result });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return c.json({ success: false, errors: [error] }, 400);
  }
});

/**
 * POST /api/import/batch
 * Path sandbox: sandboxPath(RESEARCH_IMPORT_BASE_DIR, directoryPath) with realpath canonicalization.
 * Rejects '..', absolute-path override, symlink escape, nonexistent paths.
 */
importRoutes.post('/api/import/batch', async (c) => {
  const base = process.env.RESEARCH_IMPORT_BASE_DIR;
  if (!base) {
    return c.json({ success: false, errors: ['rejected:base_dir_not_configured'] }, 400);
  }

  const parsed = z
    .object({ directoryPath: z.string().min(1) })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ success: false, errors: ['directoryPath is required'] }, 400);
  }

  let safePath: string;
  try {
    safePath = sandboxPath(base, parsed.data.directoryPath);
  } catch (e) {
    const reason = e instanceof Error ? e.message : 'path_rejected';
    return c.json({ success: false, errors: [`rejected:${reason}`] }, 400);
  }

  try {
    const results = importFromDirectory(safePath);
    return c.json({ success: true, results });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return c.json({ success: false, errors: [error] }, 400);
  }
});

export default importRoutes;
