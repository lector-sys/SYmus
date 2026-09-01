// Runs the library smoke check inside Electron, on a throwaway userData dir so
// it can never touch the real library. See src/main/smoke.ts.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import electron from 'electron'

const migrationsDir = fileURLToPath(new URL('../prisma/migrations/', import.meta.url))

/**
 * Settings persistence and library backup, checked at the SQL level rather than
 * through src/main/features/settings.ts: that module needs Electron's `app` for
 * its paths, and importing it here would mean booting a second Electron.
 *
 * Run alone with `node scripts/smoke.mjs --db-only`.
 */
function checkSettingsSql(dir) {
  let failed = false
  const ok = (label, cond, detail) => {
    console.log(
      `${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : `  -> ${JSON.stringify(detail)}`}`
    )
    if (!cond) failed = true
  }

  const db = new DatabaseSync(join(dir, 'settings.db'))
  // The real migrations, applied the way src/main/db.ts applies them.
  for (const entry of readdirSync(migrationsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()) {
    db.exec(readFileSync(join(migrationsDir, entry, 'migration.sql'), 'utf8'))
  }

  // -- Setting round trip --------------------------------------------------
  const put = db.prepare(
    'INSERT INTO "Setting" (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )
  const get = db.prepare('SELECT value FROM "Setting" WHERE key = ?')
  put.run('minimizeToTray', 'false')
  ok('setting stored', get.get('minimizeToTray')?.value === 'false')
  put.run('minimizeToTray', 'true')
  ok('setting overwritten, not duplicated', get.get('minimizeToTray')?.value === 'true')
  ok('unknown key is absent', get.get('nope') === undefined)

  // -- VACUUM INTO backup --------------------------------------------------
  // Written while the source is still open and mid-WAL, which is exactly how
  // the app takes a backup — and where a plain file copy would lose rows.
  db.exec('PRAGMA journal_mode = WAL')
  put.run('backupCanary', 'carried')
  const copy = join(dir, 'backup.db')
  db.prepare('VACUUM INTO ?').run(copy)

  const restored = new DatabaseSync(copy, { readOnly: true })
  ok(
    'backup carries the rows',
    restored.prepare('SELECT value FROM "Setting" WHERE key = ?').get('backupCanary')?.value ===
      'carried'
  )
  ok(
    'backup carries the whole schema',
    restored
      .prepare("SELECT count(*) n FROM sqlite_master WHERE type = 'table' AND name = 'Track'")
      .get().n === 1
  )
  restored.close()
  db.close()
  return !failed
}

const dir = mkdtempSync(join(tmpdir(), 'symus-smoke-'))
try {
  if (!checkSettingsSql(dir)) process.exit(1)
  if (process.argv.includes('--db-only')) process.exit(0)

  const { status } = spawnSync(electron, ['.', '--smoke', `--user-data-dir=${dir}`], {
    stdio: 'inherit'
  })
  process.exit(status ?? 1)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
