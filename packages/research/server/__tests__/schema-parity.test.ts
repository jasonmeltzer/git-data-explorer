/**
 * Schema-parity guard: after applying migrations to a fresh :memory: DB,
 * verifies that each table's columns exactly match what schema.ts declares.
 *
 * This test fails LOUD on future drift between schema.ts and the migration files.
 * If schema.ts gains a new column but migrations are not updated, this test surfaces it.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootstrapMigrationJournal } from '../db/migrate.js';
import * as schema from '../db/schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = path.resolve(__dirname, '..', '..', 'drizzle', 'migrations');

let sqlite: Database.Database;

beforeAll(() => {
  sqlite = new Database(':memory:');
  const db = drizzle(sqlite);
  bootstrapMigrationJournal(sqlite, MIGRATIONS_FOLDER);
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
});

afterAll(() => {
  sqlite.close();
});

// All tables exported from schema.ts
const SCHEMA_TABLES: Array<[string, ReturnType<typeof getTableConfig>]> = [
  ['orgs', getTableConfig(schema.orgs)],
  ['snapshots', getTableConfig(schema.snapshots)],
  ['cohortMetrics', getTableConfig(schema.cohortMetrics)],
  ['rampUp', getTableConfig(schema.rampUp)],
  ['rollingComparisons', getTableConfig(schema.rollingComparisons)],
  ['contributors', getTableConfig(schema.contributors)],
  ['prTurnaround', getTableConfig(schema.prTurnaround)],
  ['botRatio', getTableConfig(schema.botRatio)],
  ['concentrationMonthly', getTableConfig(schema.concentrationMonthly)],
  ['headcountMonthly', getTableConfig(schema.headcountMonthly)],
  ['developerMonthly', getTableConfig(schema.developerMonthly)],
  ['periodMetrics', getTableConfig(schema.periodMetrics)],
];

describe('schema-parity: migrations match schema.ts column declarations', () => {
  for (const [exportName, tableConfig] of SCHEMA_TABLES) {
    const tableName = tableConfig.name;
    const schemaColumnNames = tableConfig.columns.map((c) => c.name).sort();

    test(`${tableName} (${exportName}): DB columns match schema.ts exactly`, () => {
      const dbCols = sqlite
        .prepare(`PRAGMA table_info(${tableName})`)
        .all() as Array<{ name: string }>;
      const dbColumnNames = dbCols.map((c) => c.name).sort();

      expect(dbColumnNames).toEqual(schemaColumnNames);
    });
  }
});
