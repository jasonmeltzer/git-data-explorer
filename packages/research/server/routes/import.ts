import { Hono } from 'hono';
import { importBundle, importFromUrl, importFromDirectory, parseZipBundle } from '../services/import-service.js';

const importRoutes = new Hono();

/**
 * POST /api/import/file
 * Accept multipart form data with a file field containing JSON or ZIP bundle.
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
 * Accept JSON body { url: string, orgId?: number, orgLabel?: string }.
 * Supports Gist URLs and plain HTTP URLs.
 */
importRoutes.post('/api/import/url', async (c) => {
  try {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.url !== 'string' || body.url.trim() === '') {
      return c.json({ success: false, errors: ['url is required'] }, 400);
    }

    const url: string = body.url.trim();
    const orgId: number | null = typeof body.orgId === 'number' ? body.orgId : null;
    const orgLabel: string | undefined = typeof body.orgLabel === 'string' ? body.orgLabel : undefined;

    // Detect source type from URL
    const source = url.includes('gist.github.com') ? 'gist' : 'url';
    const bundle = await importFromUrl(url, source);

    const result = importBundle(bundle, orgId, source, orgLabel);
    return c.json({ success: true, ...result });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return c.json({ success: false, errors: [error] }, 400);
  }
});

/**
 * POST /api/import/batch
 * Accept JSON body { directoryPath: string }.
 * Imports all .json and .zip files in the directory.
 */
importRoutes.post('/api/import/batch', async (c) => {
  try {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.directoryPath !== 'string' || body.directoryPath.trim() === '') {
      return c.json({ success: false, errors: ['directoryPath is required'] }, 400);
    }

    const results = importFromDirectory(body.directoryPath.trim());
    return c.json({ success: true, results });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return c.json({ success: false, errors: [error] }, 400);
  }
});

export default importRoutes;
