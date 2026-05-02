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
CREATE INDEX `idx_developer_monthly_snapshot_author` ON `developer_monthly` (`snapshot_id`,`author_login`);