import { defineConfig } from 'prisma/config'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

// Dev-only: the CLI needs a concrete database to diff migrations against.
// The app itself opens its own DB in Electron's userData dir (src/main/db.ts).
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: 'file:./prisma/dev.db' },
  adapter: async () => new PrismaBetterSqlite3({ url: 'file:./prisma/dev.db' })
})
