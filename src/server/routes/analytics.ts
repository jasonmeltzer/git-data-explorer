import { Hono } from 'hono';
import { z } from 'zod';
import { getAiMarkerDate, setAiMarkerDate } from '../services/analytics-config.js';
import { getCohortCommitMetrics, getCohortPrMetrics } from '../services/analytics-cohorts.js';
import { getRampUpCurves } from '../services/analytics-rampup.js';
import { getRollingComparison } from '../services/analytics-rolling.js';

const analytics = new Hono();

// ─── AI Marker endpoints ──────────────────────────────────────────────────────

// GET /api/analytics/marker — returns current AI marker date
analytics.get('/api/analytics/marker', (c) => {
  try {
    const date = getAiMarkerDate();
    return c.json({ date: date ? date.toISOString() : null });
  } catch (err) {
    console.error('GET /api/analytics/marker error:', err);
    return c.json({ error: 'Failed to get AI marker date' }, 500);
  }
});

// POST /api/analytics/marker — set or clear AI marker date
analytics.post('/api/analytics/marker', async (c) => {
  try {
    const body = await c.req.json().catch(() => null);
    const schema = z.object({ date: z.string().nullable() });
    const parsed = schema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: 'Invalid request: date must be a string or null' }, 400);
    }

    const { date } = parsed.data;
    if (date === null) {
      setAiMarkerDate(null);
    } else {
      const parsed_date = new Date(date);
      if (isNaN(parsed_date.getTime())) {
        return c.json({ error: 'Invalid date string' }, 400);
      }
      setAiMarkerDate(parsed_date);
    }

    return c.json({ ok: true });
  } catch (err) {
    console.error('POST /api/analytics/marker error:', err);
    return c.json({ error: 'Failed to set AI marker date' }, 500);
  }
});

// ─── Cohort endpoints ─────────────────────────────────────────────────────────

const cohortQuerySchema = z.object({
  startDate: z.string().refine(v => !isNaN(new Date(v).getTime()), {
    message: 'startDate must be a valid date string',
  }),
  endDate: z.string().refine(v => !isNaN(new Date(v).getTime()), {
    message: 'endDate must be a valid date string',
  }),
  tenureMode: z.enum(['global', 'repo']).default('global'),
  repoIds: z.string().optional(),
});

// GET /api/analytics/cohorts/commits — cohort commit metrics
analytics.get('/api/analytics/cohorts/commits', (c) => {
  try {
    const parsed = cohortQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: 'Invalid query parameters', details: parsed.error.flatten() }, 400);
    }

    const { startDate, endDate, tenureMode, repoIds } = parsed.data;
    const repoIdsParsed = repoIds?.split(',').map(Number).filter(n => Number.isInteger(n) && n > 0);
    const aiMarkerDate = getAiMarkerDate();

    const results = getCohortCommitMetrics({
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      tenureMode,
      repoIds: repoIdsParsed,
      aiMarkerDate,
    });

    return c.json(results);
  } catch (err) {
    console.error('GET /api/analytics/cohorts/commits error:', err);
    return c.json({ error: 'Failed to fetch cohort commit metrics' }, 500);
  }
});

// GET /api/analytics/cohorts/prs — cohort PR metrics
analytics.get('/api/analytics/cohorts/prs', (c) => {
  try {
    const parsed = cohortQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: 'Invalid query parameters', details: parsed.error.flatten() }, 400);
    }

    const { startDate, endDate, tenureMode, repoIds } = parsed.data;
    const repoIdsParsed = repoIds?.split(',').map(Number).filter(n => Number.isInteger(n) && n > 0);
    const aiMarkerDate = getAiMarkerDate();

    const results = getCohortPrMetrics({
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      tenureMode,
      repoIds: repoIdsParsed,
      aiMarkerDate,
    });

    return c.json(results);
  } catch (err) {
    console.error('GET /api/analytics/cohorts/prs error:', err);
    return c.json({ error: 'Failed to fetch cohort PR metrics' }, 500);
  }
});

// ─── Ramp-up endpoint ─────────────────────────────────────────────────────────

// GET /api/analytics/rampup — ramp-up curves
analytics.get('/api/analytics/rampup', (c) => {
  try {
    const schema = z.object({
      tenureMode: z.enum(['global', 'repo']).default('global'),
      repoIds: z.string().optional(),
      joinPeriodGranularity: z.enum(['quarter', 'half', 'year']).default('quarter'),
    });

    const parsed = schema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: 'Invalid query parameters', details: parsed.error.flatten() }, 400);
    }

    const { tenureMode, repoIds, joinPeriodGranularity } = parsed.data;
    const repoIdsParsed = repoIds?.split(',').map(Number).filter(n => Number.isInteger(n) && n > 0);

    const results = getRampUpCurves({
      tenureMode,
      repoIds: repoIdsParsed,
      joinPeriodGranularity,
    });

    return c.json(results);
  } catch (err) {
    console.error('GET /api/analytics/rampup error:', err);
    return c.json({ error: 'Failed to fetch ramp-up curves' }, 500);
  }
});

// ─── Rolling comparison endpoint ──────────────────────────────────────────────

// GET /api/analytics/rolling — rolling window comparison
analytics.get('/api/analytics/rolling', (c) => {
  try {
    const schema = z.object({
      granularity: z.enum(['month', 'quarter']).default('month'),
      repoIds: z.string().optional(),
    });

    const parsed = schema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: 'Invalid query parameters', details: parsed.error.flatten() }, 400);
    }

    const { granularity, repoIds } = parsed.data;
    const repoIdsParsed = repoIds?.split(',').map(Number).filter(n => Number.isInteger(n) && n > 0);

    const result = getRollingComparison({
      granularity,
      repoIds: repoIdsParsed,
    });

    return c.json(result);
  } catch (err) {
    console.error('GET /api/analytics/rolling error:', err);
    return c.json({ error: 'Failed to fetch rolling comparison' }, 500);
  }
});

export default analytics;
