-- Migration 0001: Drop legacy columns that were included in 0000_initial.sql for
-- backward compatibility with pre-9.4 research.db installations.
-- These columns are absent from schema.ts as of Phase 9.4.
-- Running on a fresh DB: 0000 creates them, 0001 drops them — net result matches schema.ts.
-- Running on a legacy DB: bootstrapMigrationJournal() in migrate.ts pre-seeds 0000 as applied,
-- so drizzle skips 0000 (avoids CREATE TABLE conflict) and runs this 0001 to drop the columns.
ALTER TABLE `snapshots` DROP COLUMN `before_after_json`;
--> statement-breakpoint
ALTER TABLE `orgs` DROP COLUMN `industry`;
--> statement-breakpoint
ALTER TABLE `orgs` DROP COLUMN `ai_tool`;
