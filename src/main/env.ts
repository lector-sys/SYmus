import { app } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Loads KEY=VALUE pairs from a .env file into process.env.
 *
 * Twelve lines instead of a dependency. Checks the working directory first so a
 * dev run picks up the repo's .env, then userData, which is the only writable
 * location a packaged app can rely on across updates.
 *
 * Existing environment variables always win, so a real environment can override
 * the file.
 */
export function loadEnv(): string | null {
  const candidates = [join(process.cwd(), '.env'), join(app.getPath('userData'), '.env')]
  const file = candidates.find((p) => existsSync(p))
  if (!file) return null

  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 1) continue
    const key = trimmed.slice(0, eq).trim()
    // Strip one layer of matching quotes; values with '=' in them stay intact.
    const value = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, '$2')
    if (!(key in process.env)) process.env[key] = value
  }
  return file
}
