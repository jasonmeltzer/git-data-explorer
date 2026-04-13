DROP INDEX `idx_collection_repo_type`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_collection_repo_type_unique` ON `collection_state` (`repo_id`,`resource_type`);