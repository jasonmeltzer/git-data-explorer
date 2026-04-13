import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './server/db/schema.ts',
  out: './drizzle/migrations',
  dbCredentials: {
    url: process.env.RESEARCH_DB_PATH ?? './data/research.db',
  },
});
