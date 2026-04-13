/**
 * Cross-org analytics API routes.
 * All endpoints operate on the research DB (no GitHub auth required).
 */

import { Hono } from 'hono';
import { getAggregatedCohortMetrics, getAggregatedRampUp, getOrgComparisonTable } from '../services/aggregation.js';

const analyticsRoutes = new Hono();

/**
 * GET /api/analytics/cross-org/cohort-metrics
 * Query params:
 *   - mode: 'weighted' | 'normalized' (default: 'weighted')
 *   - orgIds: comma-separated org IDs (required)
 *   - metricType: 'commits' | 'prs' (default: 'commits')
 */
analyticsRoutes.get('/api/analytics/cross-org/cohort-metrics', (c) => {
  const modeParam = c.req.query('mode') ?? 'weighted';
  const orgIdsParam = c.req.query('orgIds') ?? '';
  const metricTypeParam = c.req.query('metricType') ?? 'commits';

  // Validate mode
  if (modeParam !== 'weighted' && modeParam !== 'normalized') {
    return c.json({ error: 'mode must be "weighted" or "normalized"' }, 400);
  }

  // Validate metricType
  if (metricTypeParam !== 'commits' && metricTypeParam !== 'prs') {
    return c.json({ error: 'metricType must be "commits" or "prs"' }, 400);
  }

  // Parse orgIds
  if (!orgIdsParam) {
    return c.json({ error: 'orgIds is required' }, 400);
  }
  const orgIds = orgIdsParam.split(',').map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id));
  if (orgIds.length === 0) {
    return c.json({ error: 'orgIds must contain valid integers' }, 400);
  }

  try {
    const result = getAggregatedCohortMetrics(
      modeParam as 'weighted' | 'normalized',
      orgIds,
      metricTypeParam as 'commits' | 'prs'
    );
    return c.json(result);
  } catch (err) {
    console.error('Error in /api/analytics/cross-org/cohort-metrics:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * GET /api/analytics/cross-org/ramp-up
 * Query params:
 *   - mode: 'weighted' | 'normalized' (default: 'weighted')
 *   - orgIds: comma-separated org IDs (required)
 */
analyticsRoutes.get('/api/analytics/cross-org/ramp-up', (c) => {
  const modeParam = c.req.query('mode') ?? 'weighted';
  const orgIdsParam = c.req.query('orgIds') ?? '';

  if (modeParam !== 'weighted' && modeParam !== 'normalized') {
    return c.json({ error: 'mode must be "weighted" or "normalized"' }, 400);
  }

  if (!orgIdsParam) {
    return c.json({ error: 'orgIds is required' }, 400);
  }
  const orgIds = orgIdsParam.split(',').map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id));
  if (orgIds.length === 0) {
    return c.json({ error: 'orgIds must contain valid integers' }, 400);
  }

  try {
    const result = getAggregatedRampUp(
      modeParam as 'weighted' | 'normalized',
      orgIds
    );
    return c.json(result);
  } catch (err) {
    console.error('Error in /api/analytics/cross-org/ramp-up:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * GET /api/analytics/cross-org/comparison
 * Query params:
 *   - orgIds: comma-separated org IDs (required)
 */
analyticsRoutes.get('/api/analytics/cross-org/comparison', (c) => {
  const orgIdsParam = c.req.query('orgIds') ?? '';

  if (!orgIdsParam) {
    return c.json({ error: 'orgIds is required' }, 400);
  }
  const orgIds = orgIdsParam.split(',').map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id));
  if (orgIds.length === 0) {
    return c.json({ error: 'orgIds must contain valid integers' }, 400);
  }

  try {
    const result = getOrgComparisonTable(orgIds);
    return c.json(result);
  } catch (err) {
    console.error('Error in /api/analytics/cross-org/comparison:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * GET /api/health
 * No auth required — research server health check.
 */
analyticsRoutes.get('/api/health', (c) => {
  return c.json({ status: 'ok' });
});

export { analyticsRoutes };
