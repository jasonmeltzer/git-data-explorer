import { Hono } from 'hono';
import { z } from 'zod';
import { createOctokit } from '../services/octokit.js';
import { listAllRepos, getAuthenticatedLogin } from '../services/github-repos.js';
import {
  getTrackedRepos,
  getStoppedRepos,
  addRepos,
  stopTracking,
  getDeleteCounts,
  deleteRepoData,
} from '../services/repo-management.js';
import { collectionQueue } from '../services/collection-queue.js';

const repos = new Hono();

// GET /api/repos/available — list all GitHub repos accessible to the PAT
// NOTE: Must be defined before /api/repos/:id routes to avoid path conflicts
repos.get('/api/repos/available', async (c) => {
  const octokit = createOctokit();
  if (!octokit) {
    return c.json({ error: 'GitHub token not configured' }, 401);
  }

  try {
    const [repoList, login] = await Promise.all([
      listAllRepos(octokit),
      getAuthenticatedLogin(octokit),
    ]);

    const mappedRepos = repoList.map((r) => ({
      githubId: r.id,
      fullName: r.full_name,
      name: r.name,
      ownerLogin: r.owner.login,
      isPrivate: r.private,
      defaultBranch: r.default_branch,
      repoCreatedAt: r.created_at ?? undefined,
    }));

    return c.json({ repos: mappedRepos, authenticatedLogin: login });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: `GitHub API error: ${message}` }, 502);
  }
});

// GET /api/repos/stopped — repos that were stopped (soft-deleted)
repos.get('/api/repos/stopped', (c) => {
  const stoppedRepos = getStoppedRepos();
  return c.json({ repos: stoppedRepos });
});

// GET /api/repos — return all actively tracked repos
repos.get('/api/repos', (c) => {
  const trackedRepos = getTrackedRepos();
  return c.json({ repos: trackedRepos });
});

// POST /api/repos — add one or more repos to track
const addReposSchema = z.object({
  repos: z.array(
    z.object({
      githubId: z.number(),
      fullName: z.string(),
      name: z.string(),
      ownerLogin: z.string(),
      isPrivate: z.boolean(),
      defaultBranch: z.string().default('main'),
      repoCreatedAt: z.string().optional(),
    })
  ),
});

repos.post('/api/repos', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = addReposSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.message }, 400);
  }

  addRepos(parsed.data.repos);

  // D-02: Auto-start collection when exactly 1 repo is added
  if (parsed.data.repos.length === 1) {
    const tracked = getTrackedRepos();
    const newRepo = tracked.find((r) => r.githubId === parsed.data.repos[0].githubId);
    if (newRepo) {
      // Fire-and-forget — collection runs in background
      collectionQueue.startSingleRepo(newRepo.id).catch((err) => {
        console.error('Auto-start collection error:', err);
      });
    }
  }

  return c.json({ success: true });
});

// PATCH /api/repos/:id/stop — soft-delete a repo (stop tracking)
repos.patch('/api/repos/:id/stop', (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) {
    return c.json({ success: false, error: 'Invalid repo id' }, 400);
  }
  stopTracking(id);
  return c.json({ success: true });
});

// GET /api/repos/:id/delete-preview — get counts before hard-delete
repos.get('/api/repos/:id/delete-preview', (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) {
    return c.json({ error: 'Invalid repo id' }, 400);
  }
  const counts = getDeleteCounts(id);
  return c.json({ commits: counts.commits, prs: counts.prs });
});

// DELETE /api/repos/:id — hard-delete all repo data
repos.delete('/api/repos/:id', (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) {
    return c.json({ success: false, error: 'Invalid repo id' }, 400);
  }
  deleteRepoData(id);
  return c.json({ success: true });
});

export default repos;
