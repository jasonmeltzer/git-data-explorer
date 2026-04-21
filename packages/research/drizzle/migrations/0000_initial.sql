-- Migration 0000: Initial schema — UNION of legacy (pre-9.4) and current schemas.
-- This file intentionally includes legacy columns (industry, ai_tool on orgs;
-- before_after_json on snapshots) that are NOT in current schema.ts.
-- Rationale: 0001_drop_legacy_columns.sql drops all three columns on BOTH fresh
-- installs AND legacy DBs without conditional SQL. On existing DBs, runMigrations()
-- bootstraps __drizzle_migrations to skip this file (tables already exist).
CREATE TABLE `orgs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`label` text NOT NULL,
	`industry` text,
	`ai_tool` text,
	`size_category` text,
	`import_source` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`import_timestamp` integer NOT NULL,
	`metadata_json` text NOT NULL,
	`tool_version` text,
	`start_date` text,
	`end_date` text,
	`ai_marker_date` text,
	`contributor_count` integer,
	`repo_count` integer,
	`content_hash` text,
	`executive_summary_json` text,
	`before_after_json` text,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `cohort_metrics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`snapshot_id` integer NOT NULL,
	`org_id` integer NOT NULL,
	`metric_type` text NOT NULL,
	`cohort` text NOT NULL,
	`period` text NOT NULL,
	`period_month` text NOT NULL,
	`avg_lines_added` real DEFAULT 0 NOT NULL,
	`avg_lines_deleted` real DEFAULT 0 NOT NULL,
	`avg_files_changed` real DEFAULT 0 NOT NULL,
	`total_count` integer DEFAULT 0 NOT NULL,
	`contributor_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `snapshots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `ramp_up` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`snapshot_id` integer NOT NULL,
	`org_id` integer NOT NULL,
	`week_index` integer NOT NULL,
	`join_period` text NOT NULL,
	`avg_lines_changed` real DEFAULT 0 NOT NULL,
	`avg_files_changed` real DEFAULT 0 NOT NULL,
	`contribution_count` integer DEFAULT 0 NOT NULL,
	`contributor_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `snapshots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `rolling_comparisons` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`snapshot_id` integer NOT NULL,
	`org_id` integer NOT NULL,
	`data_json` text NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `snapshots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `contributors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`snapshot_id` integer NOT NULL,
	`org_id` integer NOT NULL,
	`author_login` text NOT NULL,
	`cohort` text NOT NULL,
	`first_commit_at` text,
	`pre_json` text,
	`post_json` text,
	FOREIGN KEY (`snapshot_id`) REFERENCES `snapshots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `pr_turnaround` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`snapshot_id` integer NOT NULL,
	`org_id` integer NOT NULL,
	`period_month` text NOT NULL,
	`avg_hours_to_merge` real DEFAULT 0 NOT NULL,
	`median_hours_to_merge` real DEFAULT 0 NOT NULL,
	`pr_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `snapshots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `bot_ratio` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`snapshot_id` integer NOT NULL,
	`org_id` integer NOT NULL,
	`period_month` text NOT NULL,
	`bot_commits` integer DEFAULT 0 NOT NULL,
	`human_commits` integer DEFAULT 0 NOT NULL,
	`total_commits` integer DEFAULT 0 NOT NULL,
	`bot_percentage` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `snapshots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `concentration_monthly` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`snapshot_id` integer NOT NULL,
	`org_id` integer NOT NULL,
	`basis` text NOT NULL,
	`period_month` text NOT NULL,
	`top1_share` real,
	`top3_share` real,
	`top5_share` real,
	`hhi` real,
	`gini` real,
	`bus_factor` integer,
	`active_devs` integer NOT NULL,
	`top_contributor` text,
	FOREIGN KEY (`snapshot_id`) REFERENCES `snapshots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `headcount_monthly` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`snapshot_id` integer NOT NULL,
	`org_id` integer NOT NULL,
	`period_month` text NOT NULL,
	`active_devs` integer NOT NULL,
	`total_prs` integer NOT NULL,
	`total_commits` integer NOT NULL,
	`prs_per_dev` real,
	`commits_per_dev` real,
	FOREIGN KEY (`snapshot_id`) REFERENCES `snapshots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `period_metrics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`snapshot_id` integer NOT NULL,
	`org_id` integer NOT NULL,
	`data_json` text NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `snapshots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_cohort_metrics_org` ON `cohort_metrics` (`org_id`,`metric_type`);
--> statement-breakpoint
CREATE INDEX `idx_cohort_metrics_snapshot` ON `cohort_metrics` (`snapshot_id`);
--> statement-breakpoint
CREATE INDEX `idx_ramp_up_org` ON `ramp_up` (`org_id`);
--> statement-breakpoint
CREATE INDEX `idx_contributors_org` ON `contributors` (`org_id`);
--> statement-breakpoint
CREATE INDEX `idx_pr_turnaround_org` ON `pr_turnaround` (`org_id`);
--> statement-breakpoint
CREATE INDEX `idx_bot_ratio_org` ON `bot_ratio` (`org_id`);
--> statement-breakpoint
CREATE INDEX `idx_concentration_monthly_org` ON `concentration_monthly` (`org_id`,`basis`);
--> statement-breakpoint
CREATE INDEX `idx_headcount_monthly_org` ON `headcount_monthly` (`org_id`);
