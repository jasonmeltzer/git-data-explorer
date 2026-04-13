CREATE TABLE `app_config` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `authors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`github_login` text NOT NULL,
	`name` text,
	`is_bot` integer DEFAULT false NOT NULL,
	`first_commit_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `authors_github_login_unique` ON `authors` (`github_login`);--> statement-breakpoint
CREATE TABLE `collection_state` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`repo_id` integer NOT NULL,
	`resource_type` text NOT NULL,
	`cursor` text,
	`last_page` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`last_run_at` integer,
	`error_message` text,
	FOREIGN KEY (`repo_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_collection_repo_type` ON `collection_state` (`repo_id`,`resource_type`);--> statement-breakpoint
CREATE TABLE `commits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sha` text NOT NULL,
	`repo_id` integer NOT NULL,
	`author_id` integer,
	`message` text NOT NULL,
	`committed_at` integer NOT NULL,
	`lines_added` integer DEFAULT 0 NOT NULL,
	`lines_deleted` integer DEFAULT 0 NOT NULL,
	`files_changed` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_id`) REFERENCES `authors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_commits_repo_date` ON `commits` (`repo_id`,`committed_at`);--> statement-breakpoint
CREATE INDEX `idx_commits_author` ON `commits` (`author_id`);--> statement-breakpoint
CREATE INDEX `idx_commits_sha_repo` ON `commits` (`sha`,`repo_id`);--> statement-breakpoint
CREATE TABLE `pull_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`github_id` integer NOT NULL,
	`repo_id` integer NOT NULL,
	`author_id` integer,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`state` text NOT NULL,
	`created_at` integer NOT NULL,
	`merged_at` integer,
	`closed_at` integer,
	`updated_at` integer NOT NULL,
	`lines_added` integer DEFAULT 0 NOT NULL,
	`lines_deleted` integer DEFAULT 0 NOT NULL,
	`files_changed` integer DEFAULT 0 NOT NULL,
	`commit_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_id`) REFERENCES `authors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_prs_repo_date` ON `pull_requests` (`repo_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_prs_author` ON `pull_requests` (`author_id`);--> statement-breakpoint
CREATE INDEX `idx_prs_github_id_repo` ON `pull_requests` (`github_id`,`repo_id`);--> statement-breakpoint
CREATE TABLE `repositories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`github_id` integer NOT NULL,
	`full_name` text NOT NULL,
	`owner_login` text NOT NULL,
	`name` text NOT NULL,
	`is_private` integer DEFAULT false NOT NULL,
	`default_branch` text DEFAULT 'main' NOT NULL,
	`added_at` integer NOT NULL,
	`removed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `repositories_github_id_unique` ON `repositories` (`github_id`);