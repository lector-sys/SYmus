import { app } from 'electron'
import { join } from 'node:path'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from './db/generated/client'

// Migration SQL is inlined into the bundle at build time, so the packaged app
// needs no prisma CLI, no schema engine, and no files outside the asar.
const migrations = import.meta.glob('../../prisma/migrations/*/migration.sql', {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>

const url = `file:${join(app.getPath('userData'), 'symus.db')}`

export const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) })

/** Applies any migration this database has not seen yet. Safe to call on every boot. */
export async function migrate(): Promise<void> {
  await prisma.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY)')
  const applied = await prisma.$queryRawUnsafe<{ name: string }[]>('SELECT name FROM _migrations')
  const done = new Set(applied.map((r) => r.name))

  for (const path of Object.keys(migrations).sort()) {
    const name = path.split('/').at(-2)!
    if (done.has(name)) continue
    // ponytail: naive `;` split. Fine for Prisma-generated DDL, which never puts a
    // semicolon inside a literal. Swap in a real splitter if we hand-write migrations.
    for (const stmt of migrations[path]
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)) {
      await prisma.$executeRawUnsafe(stmt)
    }
    await prisma.$executeRawUnsafe('INSERT INTO _migrations (name) VALUES (?)', name)
    console.log('[db] applied migration', name)
  }
}
