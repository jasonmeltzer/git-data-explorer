import { Hono } from 'hono';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { appConfig } from '../db/schema.js';
import { getTokenStatus, validateAndSaveToken } from '../services/token.js';
import { getDepthSetting, setDepthSetting } from '../services/collection-state.js';

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

// PUT /api/settings/sharing/enable — user enables sharing
settings.put('/api/settings/sharing/enable', (c) => {
  upsertConfigKey('sharing_enabled', 'true');
  upsertConfigKey('sharing_declined', 'false');
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

export default settings;
