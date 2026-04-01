import { Hono } from 'hono';
import { z } from 'zod';
import { getAiMarkerDate, setAiMarkerDate } from '../services/analytics-config.js';
import { getCohortCommitMetrics, getCohortPrMetrics } from '../services/analytics-cohorts.js';
import { getRampUpCurves } from '../services/analytics-rampup.js';
import { getRollingComparison } from '../services/analytics-rolling.js';
import { getContributorStats } from '../services/analytics-contributors.js';
import { getCohortConfig, setCohortConfig } from '../services/cohort-config-service.js';
import { getPrTurnaroundTrend } from '../services/analytics-pr-turnaround.js';
import { getBotRatioTrend } from '../services/analytics-bot-ratio.js';
import { getExecutiveSummary } from '../services/analytics-summary.js';
import { getBeforeAfterComparison } from '../services/analytics-before-after.js';

const analytics = new Hono();

// ─── AI Marker endpoints ──────────────────────────────────────────────────────

// GET /api/analytics/marker — returns current AI marker date
analytics.get('/api/analytics/marker', (c) => {
  try {
    const date = getAiMarkerDate();
    return c.json({ date: date ? date.toISOString().split('T')[0] : null });
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

// ─── Cohort Config endpoints ──────────────────────────────────────────────────

// GET /api/analytics/cohort-config — returns current cohort config
analytics.get('/api/analytics/cohort-config', (c) => {
  try {
    const config = getCohortConfig();
    return c.json(config);
  } catch (err) {
    console.error('GET /api/analytics/cohort-config error:', err);
    return c.json({ error: 'Failed to get cohort config' }, 500);
  }
});

const cohortThresholdSchema = z.object({
  maxMonths: z.number().nullable(),
  key: z.string().min(1),
  label: z.string().min(1),
  color: z.string().min(1),
});

const cohortConfigBodySchema = z.object({
  thresholds: z.tuple([cohortThresholdSchema, cohortThresholdSchema, cohortThresholdSchema]),
});

// POST /api/analytics/cohort-config — update cohort config
analytics.post('/api/analytics/cohort-config', async (c) => {
  try {
    const body = await c.req.json().catch(() => null);
    const parsed = cohortConfigBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid request body', details: parsed.error.flatten() }, 400);
    }
    setCohortConfig(parsed.data as Parameters<typeof setCohortConfig>[0]);
    return c.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to set cohort config';
    console.error('POST /api/analytics/cohort-config error:', err);
    return c.json({ error: message }, 500);
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

// ─── Contributors endpoint ────────────────────────────────────────────────────

// GET /api/analytics/contributors — per-author aggregate stats
analytics.get('/api/analytics/contributors', (c) => {
  try {
    const parsed = cohortQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: 'Invalid query parameters', details: parsed.error.flatten() }, 400);
    }

    const { startDate, endDate, tenureMode, repoIds } = parsed.data;
    const repoIdsParsed = repoIds?.split(',').map(Number).filter(n => Number.isInteger(n) && n > 0);

    const results = getContributorStats({
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      tenureMode,
      repoIds: repoIdsParsed,
    });

    return c.json(results);
  } catch (err) {
    console.error('GET /api/analytics/contributors error:', err);
    return c.json({ error: 'Failed to fetch contributor stats' }, 500);
  }
});

// ─── PR turnaround endpoint ───────────────────────────────────────────────────

const trendQuerySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  repoIds: z.string().optional(),
});

// GET /api/analytics/pr-turnaround — monthly avg hours to merge for merged PRs
analytics.get('/api/analytics/pr-turnaround', (c) => {
  try {
    const parsed = trendQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: 'Invalid query parameters', details: parsed.error.flatten() }, 400);
    }

    const { startDate, endDate, repoIds } = parsed.data;
    const repoIdsParsed = repoIds?.split(',').map(Number).filter(n => Number.isInteger(n) && n > 0);

    const results = getPrTurnaroundTrend({ startDate, endDate, repoIds: repoIdsParsed });
    return c.json(results);
  } catch (err) {
    console.error('GET /api/analytics/pr-turnaround error:', err);
    return c.json({ error: 'Failed to fetch PR turnaround trend' }, 500);
  }
});

// ─── Bot ratio endpoint ───────────────────────────────────────────────────────

// GET /api/analytics/bot-ratio — monthly bot vs human commit counts
analytics.get('/api/analytics/bot-ratio', (c) => {
  try {
    const parsed = trendQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: 'Invalid query parameters', details: parsed.error.flatten() }, 400);
    }

    const { startDate, endDate, repoIds } = parsed.data;
    const repoIdsParsed = repoIds?.split(',').map(Number).filter(n => Number.isInteger(n) && n > 0);

    const results = getBotRatioTrend({ startDate, endDate, repoIds: repoIdsParsed });
    return c.json(results);
  } catch (err) {
    console.error('GET /api/analytics/bot-ratio error:', err);
    return c.json({ error: 'Failed to fetch bot ratio trend' }, 500);
  }
});

// ─── Executive summary endpoint ───────────────────────────────────────────────

// GET /api/analytics/summary — aggregate KPIs for executive overview
analytics.get('/api/analytics/summary', (c) => {
  try {
    const parsed = trendQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: 'Invalid query parameters', details: parsed.error.flatten() }, 400);
    }

    const { startDate, endDate, repoIds } = parsed.data;
    const repoIdsParsed = repoIds?.split(',').map(Number).filter(n => Number.isInteger(n) && n > 0);

    const result = getExecutiveSummary({ startDate, endDate, repoIds: repoIdsParsed });
    return c.json(result);
  } catch (err) {
    console.error('GET /api/analytics/summary error:', err);
    return c.json({ error: 'Failed to fetch executive summary' }, 500);
  }
});

// ─── Before/after comparison endpoint ────────────────────────────────────────

// GET /api/analytics/before-after — metrics split at AI marker date
analytics.get('/api/analytics/before-after', (c) => {
  try {
    const schema = z.object({ repoIds: z.string().optional() });
    const parsed = schema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: 'Invalid query parameters', details: parsed.error.flatten() }, 400);
    }

    const { repoIds } = parsed.data;
    const repoIdsParsed = repoIds?.split(',').map(Number).filter(n => Number.isInteger(n) && n > 0);

    const result = getBeforeAfterComparison({ repoIds: repoIdsParsed });
    return c.json(result);
  } catch (err) {
    console.error('GET /api/analytics/before-after error:', err);
    return c.json({ error: 'Failed to fetch before/after comparison' }, 500);
  }
});

export default analytics;
