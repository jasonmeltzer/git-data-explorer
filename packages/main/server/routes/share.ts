import { Hono } from 'hono';
import { z } from 'zod';
import { Octokit } from '@octokit/rest';
import { readToken } from '../services/token.js';

const share = new Hono();

// ─── GET /api/share/reachability ──────────────────────────────────────────────
// Server-side HEAD request to check if the sharing endpoint is reachable.

share.get('/api/share/reachability', async (c) => {
  const endpointUrl = process.env.SHARING_ENDPOINT_URL;

  if (!endpointUrl) {
    return c.json({ reachable: false });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(endpointUrl, {
      method: 'HEAD',
      signal: controller.signal,
    });
    clearTimeout(timeout);

    return c.json({ reachable: res.ok });
  } catch {
    return c.json({ reachable: false });
  }
});

// ─── POST /api/share/gist ─────────────────────────────────────────────────────
// Create a private GitHub Gist with the exported data.

const gistRequestSchema = z.object({
  tier: z.enum(['summary', 'full']),
  data: z.any(),
});

share.post('/api/share/gist', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = gistRequestSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      { error: 'Invalid request body', details: parsed.error.flatten() },
      400
    );
  }

  const token = readToken();
  if (!token) {
    return c.json({ error: 'No GitHub token configured. Add your PAT in Settings first.' }, 401);
  }

  const { tier, data } = parsed.data;

  // Use plain Octokit (no throttling) — Gist creation is a one-off, not batched
  const octokit = new Octokit({ auth: token });

  // Build files based on tier
  let files: Record<string, { content: string }>;
  if (tier === 'summary') {
    files = {
      'summary-report.json': {
        content: JSON.stringify(
          { executiveSummary: data?.executiveSummary ?? null, rolling: data?.rolling ?? null, metadata: data?.metadata ?? null },
          null,
          2
        ),
      },
    };
  } else {
    // tier === 'full' — one file per data section
    files = {
      'metadata.json': { content: JSON.stringify(data?.metadata ?? null, null, 2) },
      'contributors.json': { content: JSON.stringify(data?.contributors ?? [], null, 2) },
      'cohort-commits.json': { content: JSON.stringify(data?.cohortCommits ?? [], null, 2) },
      'cohort-prs.json': { content: JSON.stringify(data?.cohortPrs ?? [], null, 2) },
      'ramp-up.json': { content: JSON.stringify(data?.rampUp ?? [], null, 2) },
      'rolling.json': { content: JSON.stringify(data?.rolling ?? null, null, 2) },
      'pr-turnaround.json': { content: JSON.stringify(data?.prTurnaround ?? [], null, 2) },
      'bot-ratio.json': { content: JSON.stringify(data?.botRatio ?? [], null, 2) },
      'executive-summary.json': { content: JSON.stringify(data?.executiveSummary ?? null, null, 2) },
      'period-metrics.json': { content: JSON.stringify(data?.periodMetrics ?? null, null, 2) },
      'concentration-monthly.json': { content: JSON.stringify(data?.concentrationMonthly ?? [], null, 2) },
      'headcount-monthly.json': { content: JSON.stringify(data?.headcountMonthly ?? [], null, 2) },
    };
  }

  try {
    const response = await octokit.rest.gists.create({
      description: 'Git Data Explorer — Anonymized AI Adoption Research Data',
      public: false,
      files,
    });

    return c.json({ gistUrl: response.data.html_url });
  } catch (err) {
    const error = err as Error & { status?: number };
    // 403 with scope-related message = missing gist scope on PAT
    if (
      error.status === 403 ||
      (error.message && (error.message.includes('scope') || error.message.includes('Not Found') || error.message.includes('accessible')))
    ) {
      return c.json(
        {
          error:
            "Your GitHub token needs the 'gist' scope. Add it in GitHub settings or choose another option.",
        },
        403
      );
    }

    console.error('POST /api/share/gist error:', err);
    return c.json({ error: 'Failed to create Gist. Try downloading instead.' }, 500);
  }
});

// ─── POST /api/share/http ─────────────────────────────────────────────────────
// Forward the export data to a configured sharing endpoint.

const httpShareRequestSchema = z.object({
  data: z.any(),
});

share.post('/api/share/http', async (c) => {
  const endpointUrl = process.env.SHARING_ENDPOINT_URL;
  if (!endpointUrl) {
    return c.json({ error: 'No sharing endpoint configured.' }, 400);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = httpShareRequestSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Invalid request body' }, 400);
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const res = await fetch(endpointUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed.data.data),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.ok) {
      return c.json({ ok: true });
    }

    return c.json({ error: 'Sharing failed. Download the file manually instead.' }, 502);
  } catch {
    return c.json({ error: 'Sharing failed. Download the file manually instead.' }, 502);
  }
});

export default share;
