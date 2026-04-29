CREATE TABLE `bot_ratio` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`snapshot_id` integer NOT NULL,
	`org_id` integer NOT NULL,
	`period_month` text NOT NULL,
	`bot_commits` integer NOT NULL,
	`human_commits` integer NOT NULL,
	`total_commits` integer NOT NULL,
	`bot_percentage` real NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `snapshots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_bot_ratio_org` ON `bot_ratio` (`org_id`);--> statement-breakpoint
CREATE TABLE `cohort_metrics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`snapshot_id` integer NOT NULL,
	`org_id` integer NOT NULL,
	`metric_type` text NOT NULL,
	`cohort` text NOT NULL,
	`period` text NOT NULL,
	`period_month` text NOT NULL,
	`avg_lines_added` real NOT NULL,
	`avg_lines_deleted` real NOT NULL,
	`avg_files_changed` real NOT NULL,
	`total_count` integer NOT NULL,
	`contributor_count` integer NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `snapshots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_cohort_metrics_org` ON `cohort_metrics` (`org_id`,`metric_type`);--> statement-breakpoint
CREATE INDEX `idx_cohort_metrics_snapshot` ON `cohort_metrics` (`snapshot_id`);--> statement-breakpoint
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
CREATE INDEX `idx_concentration_monthly_org` ON `concentration_monthly` (`org_id`,`basis`);--> statement-breakpoint
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
CREATE INDEX `idx_contributors_org` ON `contributors` (`org_id`);--> statement-breakpoint
CREATE TABLE `developer_monthly` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`snapshot_id` integer NOT NULL,
	`org_id` integer NOT NULL,
	`author_login` text NOT NULL,
	`period_month` text NOT NULL,
	`pr_count` integer NOT NULL,
	`commit_count` integer NOT NULL,
	`mean_lines_per_commit` real,
	`median_lines_per_commit` real,
	`mean_files_per_commit` real,
	`median_files_per_commit` real,
	FOREIGN KEY (`snapshot_id`) REFERENCES `snapshots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_developer_monthly_snapshot_month` ON `developer_monthly` (`snapshot_id`,`period_month`);--> statement-breakpoint
CREATE INDEX `idx_developer_monthly_snapshot_author` ON `developer_monthly` (`snapshot_id`,`author_login`);--> statement-breakpoint
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
CREATE INDEX `idx_headcount_monthly_org` ON `headcount_monthly` (`org_id`);--> statement-breakpoint
CREATE TABLE `orgs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`label` text NOT NULL,
	`size_category` text,
	`import_source` text,
	`created_at` integer NOT NULL
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
CREATE TABLE `pr_turnaround` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`snapshot_id` integer NOT NULL,
	`org_id` integer NOT NULL,
	`period_month` text NOT NULL,
	`avg_hours_to_merge` real NOT NULL,
	`median_hours_to_merge` real NOT NULL,
	`pr_count` integer NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `snapshots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_pr_turnaround_org` ON `pr_turnaround` (`org_id`);--> statement-breakpoint
CREATE TABLE `ramp_up` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`snapshot_id` integer NOT NULL,
	`org_id` integer NOT NULL,
	`week_index` integer NOT NULL,
	`avg_lines_changed` real NOT NULL,
	`avg_files_changed` real NOT NULL,
	`contribution_count` integer NOT NULL,
	`contributor_count` integer NOT NULL,
	`join_period` text NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `snapshots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_ramp_up_org` ON `ramp_up` (`org_id`);--> statement-breakpoint
CREATE TABLE `rolling_comparisons` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`snapshot_id` integer NOT NULL,
	`org_id` integer NOT NULL,
	`data_json` text NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `snapshots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE no action
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
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE no action
);
