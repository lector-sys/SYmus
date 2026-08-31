// Runs the library smoke check inside Electron, on a throwaway userData dir so
// it can never touch the real library. See src/main/smoke.ts.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import electron from 'electron'

const dir = mkdtempSync(join(tmpdir(), 'symus-smoke-'))
try {
  const { status } = spawnSync(electron, ['.', '--smoke', `--user-data-dir=${dir}`], {
    stdio: 'inherit'
  })
  process.exit(status ?? 1)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
