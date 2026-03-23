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

export default settings;
