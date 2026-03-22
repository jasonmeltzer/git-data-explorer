import { Hono } from 'hono';
import { z } from 'zod';
import { getTokenStatus, validateAndSaveToken } from '../services/token.js';

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

export default settings;
