import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';

describe('Health endpoint (INFR-02)', () => {
  it('GET /api/health returns status ok with db connected', async () => {
    const healthModule = await import('../routes/health.js');
    const app = new Hono();
    app.route('/', healthModule.default);

    const res = await app.request('/api/health');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.db).toBe('connected');
    expect(body.timestamp).toBeDefined();
  });
});
