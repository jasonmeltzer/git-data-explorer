import { Hono } from 'hono';
import { z } from 'zod';
import { buildExportBundle } from '../services/export-service.js';

// export is a reserved word — use underscore convention
const export_ = new Hono();

// Zod schema for ExportRequest body
const exportRequestSchema = z.object({
  startDate: z.string().min(1, 'startDate is required'),
  endDate: z.string().min(1, 'endDate is required'),
  repoIds: z.array(z.number().int()).default([]),
  tenureMode: z.enum(['global', 'repo']).default('global'),
  rollingGranularity: z.enum(['month', 'quarter']).default('month'),
});

// POST /api/export — build and return a complete ExportBundle
export_.post('/api/export', async (c) => {
  try {
    const body = await c.req.json().catch(() => null);
    const parsed = exportRequestSchema.safeParse(body);

    if (!parsed.success) {
      return c.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        400
      );
    }

    const bundle = buildExportBundle(parsed.data);
    return c.json(bundle);
  } catch (err) {
    console.error('POST /api/export error:', err);
    return c.json({ error: 'Failed to build export bundle' }, 500);
  }
});

export default export_;
