import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import * as schema from './schema.js';

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), 'data', 'app.db');

// Ensure the data directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const sqlite = new Database(DB_PATH);

// Set pragmas before any queries — WAL for concurrent reads during future collection
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('mmap_size = 536870912'); // 512MB memory-mapped I/O

export const db = drizzle(sqlite, { schema });
export { sqlite };
