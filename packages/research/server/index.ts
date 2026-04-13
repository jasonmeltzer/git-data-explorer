import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { sqlite } from './db/client.js';
import importRoutes from './routes/import.js';
import orgRoutes from './routes/orgs.js';
import { analyticsRoutes } from './routes/analytics.js';

// Create tables if they don't exist (no migration files needed)
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS orgs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    size_category TEXT,
    industry TEXT,
    ai_tool TEXT,
    import_source TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER NOT NULL REFERENCES orgs(id),
    import_timestamp INTEGER NOT NULL,
    metadata_json TEXT NOT NULL,
    tool_version TEXT,
    start_date TEXT,
    end_date TEXT,
    ai_marker_date TEXT,
    contributor_count INTEGER,
    repo_count INTEGER,
    content_hash TEXT,
    executive_summary_json TEXT,
    before_after_json TEXT
  );
  CREATE TABLE IF NOT EXISTS cohort_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id INTEGER NOT NULL REFERENCES snapshots(id),
    org_id INTEGER NOT NULL REFERENCES orgs(id),
    metric_type TEXT NOT NULL,
    cohort TEXT NOT NULL,
    period TEXT NOT NULL,
    period_month TEXT NOT NULL,
    avg_lines_added REAL NOT NULL DEFAULT 0,
    avg_lines_deleted REAL NOT NULL DEFAULT 0,
    avg_files_changed REAL NOT NULL DEFAULT 0,
    total_count INTEGER NOT NULL DEFAULT 0,
    contributor_count INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS ramp_up (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id INTEGER NOT NULL REFERENCES snapshots(id),
    org_id INTEGER NOT NULL REFERENCES orgs(id),
    week_index INTEGER NOT NULL,
    join_period TEXT NOT NULL,
    avg_lines_changed REAL NOT NULL DEFAULT 0,
    avg_files_changed REAL NOT NULL DEFAULT 0,
    contribution_count INTEGER NOT NULL DEFAULT 0,
    contributor_count INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS rolling_comparisons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id INTEGER NOT NULL REFERENCES snapshots(id),
    org_id INTEGER NOT NULL REFERENCES orgs(id),
    data_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS contributors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id INTEGER NOT NULL REFERENCES snapshots(id),
    org_id INTEGER NOT NULL REFERENCES orgs(id),
    author_login TEXT NOT NULL,
    cohort TEXT NOT NULL,
    first_commit_at TEXT,
    pre_json TEXT,
    post_json TEXT
  );
  CREATE TABLE IF NOT EXISTS pr_turnaround (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id INTEGER NOT NULL REFERENCES snapshots(id),
    org_id INTEGER NOT NULL REFERENCES orgs(id),
    period_month TEXT NOT NULL,
    avg_hours_to_merge REAL NOT NULL DEFAULT 0,
    median_hours_to_merge REAL NOT NULL DEFAULT 0,
    pr_count INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS bot_ratio (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id INTEGER NOT NULL REFERENCES snapshots(id),
    org_id INTEGER NOT NULL REFERENCES orgs(id),
    period_month TEXT NOT NULL,
    bot_commits INTEGER NOT NULL DEFAULT 0,
    human_commits INTEGER NOT NULL DEFAULT 0,
    total_commits INTEGER NOT NULL DEFAULT 0,
    bot_percentage REAL NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_snapshots_org_id ON snapshots(org_id);
  CREATE INDEX IF NOT EXISTS idx_cohort_metrics_snapshot ON cohort_metrics(snapshot_id);
  CREATE INDEX IF NOT EXISTS idx_cohort_metrics_org ON cohort_metrics(org_id, metric_type);
  CREATE INDEX IF NOT EXISTS idx_ramp_up_snapshot ON ramp_up(snapshot_id);
  CREATE INDEX IF NOT EXISTS idx_ramp_up_org ON ramp_up(org_id);
  CREATE INDEX IF NOT EXISTS idx_rolling_snapshot ON rolling_comparisons(snapshot_id);
  CREATE INDEX IF NOT EXISTS idx_contributors_snapshot ON contributors(snapshot_id);
  CREATE INDEX IF NOT EXISTS idx_contributors_org ON contributors(org_id);
  CREATE INDEX IF NOT EXISTS idx_pr_turnaround_snapshot ON pr_turnaround(snapshot_id);
  CREATE INDEX IF NOT EXISTS idx_pr_turnaround_org ON pr_turnaround(org_id);
  CREATE INDEX IF NOT EXISTS idx_bot_ratio_org ON bot_ratio(org_id);
`);

const app = new Hono();
app.use('/api/*', cors({ origin: 'http://localhost:5174' }));
app.route('/', importRoutes);
app.route('/', orgRoutes);
app.route('/', analyticsRoutes);

const port = parseInt(process.env.RESEARCH_PORT ?? '3002', 10);
serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, () => {
  console.log(`Research server running on http://localhost:${port}`);
});

export { app };
