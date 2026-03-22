DROP INDEX `idx_commits_sha_repo`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_commits_sha_repo` ON `commits` (`sha`,`repo_id`);--> statement-breakpoint
DROP INDEX `idx_prs_github_id_repo`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_prs_github_id_repo` ON `pull_requests` (`github_id`,`repo_id`);