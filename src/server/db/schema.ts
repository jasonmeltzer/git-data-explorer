import { sqliteTable, text, integer, index, uniqueIndex, unique } from 'drizzle-orm/sqlite-core';

// App configuration key-value store
export const appConfig = sqliteTable('app_config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// Tracked GitHub repositories
export const repositories = sqliteTable('repositories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  githubId: integer('github_id').notNull().unique(),
  fullName: text('full_name').notNull(),       // e.g., "org/repo-name"
  ownerLogin: text('owner_login').notNull(),
  name: text('name').notNull(),
  isPrivate: integer('is_private', { mode: 'boolean' }).notNull().default(false),
  defaultBranch: text('default_branch').notNull().default('main'),
  repoCreatedAt: integer('repo_created_at', { mode: 'timestamp' }),  // GitHub repo creation date
  addedAt: integer('added_at', { mode: 'timestamp' }).notNull(),
  removedAt: integer('removed_at', { mode: 'timestamp' }),  // soft delete
});

// Commit authors (contributors)
export const authors = sqliteTable('authors', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  githubLogin: text('github_login').notNull().unique(),
  name: text('name'),
  isBot: integer('is_bot', { mode: 'boolean' }).notNull().default(false),
  firstCommitAt: integer('first_commit_at', { mode: 'timestamp' }),
});

// Commits
export const commits = sqliteTable('commits', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sha: text('sha').notNull(),
  repoId: integer('repo_id').notNull().references(() => repositories.id),
  authorId: integer('author_id').references(() => authors.id),
  message: text('message').notNull(),
  committedAt: integer('committed_at', { mode: 'timestamp' }).notNull(),
  linesAdded: integer('lines_added').notNull().default(0),
  linesDeleted: integer('lines_deleted').notNull().default(0),
  filesChanged: integer('files_changed').notNull().default(0),
}, (table) => [
  index('idx_commits_repo_date').on(table.repoId, table.committedAt),
  index('idx_commits_author').on(table.authorId),
  uniqueIndex('idx_commits_sha_repo').on(table.sha, table.repoId),
  index('idx_commits_author_repo').on(table.authorId, table.repoId),
]);

// Pull requests
export const pullRequests = sqliteTable('pull_requests', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  githubId: integer('github_id').notNull(),
  repoId: integer('repo_id').notNull().references(() => repositories.id),
  authorId: integer('author_id').references(() => authors.id),
  number: integer('number').notNull(),
  title: text('title').notNull(),
  state: text('state').notNull(),   // open, closed, merged
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  mergedAt: integer('merged_at', { mode: 'timestamp' }),
  closedAt: integer('closed_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  linesAdded: integer('lines_added').notNull().default(0),
  linesDeleted: integer('lines_deleted').notNull().default(0),
  filesChanged: integer('files_changed').notNull().default(0),
  commitCount: integer('commit_count').notNull().default(0),
}, (table) => [
  index('idx_prs_repo_date').on(table.repoId, table.createdAt),
  index('idx_prs_author').on(table.authorId),
  uniqueIndex('idx_prs_github_id_repo').on(table.githubId, table.repoId),
]);

// Collection state tracking for incremental resume
export const collectionState = sqliteTable('collection_state', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  repoId: integer('repo_id').notNull().references(() => repositories.id),
  resourceType: text('resource_type').notNull(),  // 'commits' | 'pull_requests'
  cursor: text('cursor'),                          // last SHA or last updated_at
  lastPage: integer('last_page'),
  status: text('status').notNull().default('pending'), // pending, in_progress, complete, paused
  lastRunAt: integer('last_run_at', { mode: 'timestamp' }),
  errorMessage: text('error_message'),
  direction: text('direction'),                    // 'reverse' | null (null = legacy forward from Phase 3)
  oldestMonthCollected: text('oldest_month_collected'), // ISO timestamp of oldest fully-collected month start (e.g., '2026-01-01T00:00:00Z')
  depthTarget: text('depth_target'),               // ISO timestamp of the depth boundary when collection started
}, (table) => [
  uniqueIndex('idx_collection_repo_type_unique').on(table.repoId, table.resourceType),
]);
