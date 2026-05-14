import { Hono } from 'hono';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { appConfig, collectionState } from '../db/schema.js';
import { getTokenStatus, validateAndSaveToken } from '../services/token.js';
import { getDepthSetting, setDepthSetting } from '../services/collection-state.js';
import { getCycleTimeMaxDays, setCycleTimeMaxDays } from '../services/analytics-config.js';

const settings = new Hono();

// GET /api/settings/token — returns masked token status (per D-05)
settings.get('/api/settings/token', (c) => {
  const status = getTokenStatus();
  return c.json(status);
});

// POST /api/settings/token — validate and save token (per D-04)
const tokenSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

settings.post('/api/settings/token', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = tokenSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ success: false, error: 'Token is required' }, 400);
  }

  const result = await validateAndSaveToken(parsed.data.token);

  if (!result.success) {
    return c.json({ success: false, error: result.error }, 400);
  }

  return c.json({
    success: true,
    maskedToken: result.maskedToken,
    scopes: result.scopes,
    login: result.login,
  });
});

// GET /api/settings/bots — get bot inclusion setting (D-19: default false)
settings.get('/api/settings/bots', (c) => {
  const row = db
    .select()
    .from(appConfig)
    .where(eq(appConfig.key, 'include_bots'))
    .get();

  const includeBots = row?.value === 'true';
  return c.json({ includeBots });
});

// PUT /api/settings/bots — update bot inclusion setting
const botSchema = z.object({
  includeBots: z.boolean(),
});

settings.put('/api/settings/bots', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = botSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ success: false, error: 'Invalid request' }, 400);
  }

  db.insert(appConfig)
    .values({
      key: 'include_bots',
      value: String(parsed.data.includeBots),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: appConfig.key,
      set: {
        value: String(parsed.data.includeBots),
        updatedAt: new Date(),
      },
    })
    .run();

  return c.json({ success: true, includeBots: parsed.data.includeBots });
});

// GET /api/settings/depth — get current collection depth in months
settings.get('/api/settings/depth', (c) => {
  const depthMonths = getDepthSetting();
  return c.json({ depthMonths });
});

// PUT /api/settings/depth — update collection depth in months
const depthSchema = z.object({
  months: z.number().int().min(1).max(120),
});

settings.put('/api/settings/depth', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = depthSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: 'Invalid depth value' }, 400);
  }
  setDepthSetting(parsed.data.months);
  return c.json({ success: true, depthMonths: parsed.data.months });
});

// GET /api/settings/cycle-time-max-days — get current cycle-time outlier cap (D-08)
settings.get('/api/settings/cycle-time-max-days', (c) => {
  return c.json({ days: getCycleTimeMaxDays() });
});

// PUT /api/settings/cycle-time-max-days — update the cap (1-365 days)
const cycleMaxSchema = z.object({ days: z.number().int().min(1).max(365) });

settings.put('/api/settings/cycle-time-max-days', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = cycleMaxSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: 'Invalid days value (must be an integer between 1 and 365)' }, 400);
  }
  setCycleTimeMaxDays(parsed.data.days);
  return c.json({ success: true, days: parsed.data.days });
});

// ─── Sharing consent endpoints ────────────────────────────────────────────────

// Helper: read an app_config key and return its string value or null
function readConfigKey(key: string): string | null {
  const row = db.select().from(appConfig).where(eq(appConfig.key, key)).get();
  return row?.value ?? null;
}

// Helper: upsert an app_config key
function upsertConfigKey(key: string, value: string): void {
  db.insert(appConfig)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appConfig.key,
      set: { value, updatedAt: new Date() },
    })
    .run();
}

// GET /api/settings/sharing — returns current sharing consent state
settings.get('/api/settings/sharing', (c) => {
  const promptShown = readConfigKey('sharing_prompt_shown') === 'true';
  const declined = readConfigKey('sharing_declined') === 'true';
  const enabled = readConfigKey('sharing_enabled') === 'true';
  const exportCount = parseInt(readConfigKey('export_count') ?? '0', 10);

  return c.json({ promptShown, declined, enabled, exportCount });
});

// PUT /api/settings/sharing/decline — user declines sharing
settings.put('/api/settings/sharing/decline', (c) => {
  upsertConfigKey('sharing_declined', 'true');
  upsertConfigKey('sharing_prompt_shown', 'true');
  return c.json({ ok: true });
});

// PUT /api/settings/sharing/enable — user enables sharing (D-08 full reset)
settings.put('/api/settings/sharing/enable', (c) => {
  upsertConfigKey('sharing_enabled', 'true');
  upsertConfigKey('sharing_declined', 'false');
  upsertConfigKey('sharing_dismiss_count', '0');
  db.delete(appConfig).where(eq(appConfig.key, 'sharing_prompt_dismissed_at')).run();
  return c.json({ ok: true });
});

// PUT /api/settings/sharing/disable — user disables sharing
settings.put('/api/settings/sharing/disable', (c) => {
  upsertConfigKey('sharing_enabled', 'false');
  return c.json({ ok: true });
});

// POST /api/settings/sharing/increment-export — increment export_count
settings.post('/api/settings/sharing/increment-export', (c) => {
  const current = parseInt(readConfigKey('export_count') ?? '0', 10);
  const newCount = current + 1;
  upsertConfigKey('export_count', String(newCount));
  return c.json({ exportCount: newCount });
});

// PUT /api/settings/sharing/prompt-shown — mark sharing prompt as shown
settings.put('/api/settings/sharing/prompt-shown', (c) => {
  upsertConfigKey('sharing_prompt_shown', 'true');
  return c.json({ ok: true });
});

// GET /api/settings/sharing/eligible — server-side eligibility heuristic (D-01 through D-07)
settings.get('/api/settings/sharing/eligible', (c) => {
  // Gate 1: permanent decline
  if (readConfigKey('sharing_declined') === 'true') {
    return c.json({ eligible: false });
  }

  // Gate 2: soft decline via dismiss_count >= 3 (D-07)
  const dismissCount = parseInt(readConfigKey('sharing_dismiss_count') ?? '0', 10);
  if (dismissCount >= 3) {
    return c.json({ eligible: false });
  }

  // Gate 3: 24-hour cooldown after dismiss (D-06)
  const dismissedAt = readConfigKey('sharing_prompt_dismissed_at');
  if (dismissedAt && Date.now() - new Date(dismissedAt).getTime() < 86400000) {
    return c.json({ eligible: false });
  }

  // Gate 4: at least 1 prior export (D-01)
  const exportCount = parseInt(readConfigKey('export_count') ?? '0', 10);
  if (exportCount < 1) {
    return c.json({ eligible: false });
  }

  // Gate 5: 2+ repos with 3+ months of history (D-02)
  const threeMonthsAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const rows = db
    .select({ repoId: collectionState.repoId, oldestMonthCollected: collectionState.oldestMonthCollected })
    .from(collectionState)
    .all();

  const qualifyingRepoIds = new Set<number>();
  for (const row of rows) {
    if (row.oldestMonthCollected && new Date(row.oldestMonthCollected) <= threeMonthsAgo) {
      qualifyingRepoIds.add(row.repoId);
    }
  }

  return c.json({ eligible: qualifyingRepoIds.size >= 2 });
});

// PUT /api/settings/sharing/dismiss — "not now" close with 24h cooldown (D-05, D-06)
settings.put('/api/settings/sharing/dismiss', (c) => {
  upsertConfigKey('sharing_prompt_dismissed_at', new Date().toISOString());
  const current = parseInt(readConfigKey('sharing_dismiss_count') ?? '0', 10);
  upsertConfigKey('sharing_dismiss_count', String(current + 1));
  return c.json({ ok: true });
});

export default settings;
