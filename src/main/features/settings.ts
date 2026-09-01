import { app, dialog, BrowserWindow } from 'electron'
import type { IpcMain } from 'electron'
import { copyFileSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '../db/generated/client'
import { prisma } from '../db'

/**
 * IPC for the Settings page: app version, launch-on-startup, minimize-to-tray,
 * and library backup/restore.
 *
 * Registered from src/main/index.ts via the feature list, so this file is the
 * only place these touch the main process.
 */

// src/main/db.ts keeps its connection URL private, so the path is rebuilt here.
// It must stay in step with that file, or backup and restore would copy a
// database the running app is not using.
const dbFile = (): string => join(app.getPath('userData'), 'symus.db')

// Every table the schema defines. A file missing any of them is not a library
// we can run against, and swapping it in would leave the app unable to boot.
const REQUIRED_TABLES = [
  'Track',
  'Playlist',
  'PlaylistTrack',
  'Like',
  'Dislike',
  'HistoryEntry',
  'Lyrics',
  'SearchQuery',
  'Setting'
]

// Electron does not implement login items on Linux, where autostart is a
// .desktop file in the user's config. The page disables the control instead of
// us shipping a second, untested implementation.
const startupSupported = process.platform !== 'linux'

export function launchOnStartup(): { supported: boolean; enabled: boolean } {
  // The OS is the source of truth: the user can revoke this in the system
  // settings at any time, and a mirrored copy in our database would go stale.
  return {
    supported: startupSupported,
    enabled: startupSupported ? app.getLoginItemSettings().openAtLogin : false
  }
}

export function setLaunchOnStartup(on: boolean): boolean {
  if (!startupSupported) return false
  app.setLoginItemSettings({ openAtLogin: on })
  // Read back rather than echoing the request: the write can be refused by
  // policy, and the page would otherwise show a toggle the OS ignored.
  return app.getLoginItemSettings().openAtLogin
}

// The window's close handler runs synchronously and cannot await a query, so
// the stored value is cached here at boot and updated on every write.
let minimizeToTray = true
const MINIMIZE_KEY = 'minimizeToTray'

/** Reads the persisted preferences into memory. Call once, after migrate(). */
export async function loadSettings(): Promise<void> {
  const row = await prisma.setting.findUnique({ where: { key: MINIMIZE_KEY } })
  // Absent means never chosen: a tray app that quits on X by default would
  // surprise anyone who has used one before.
  minimizeToTray = row ? row.value === 'true' : true
}

/** What the close handler asks: hide to the tray, or let the window close. */
export const shouldMinimizeToTray = (): boolean => minimizeToTray

export async function setMinimizeToTray(on: boolean): Promise<boolean> {
  await prisma.setting.upsert({
    where: { key: MINIMIZE_KEY },
    create: { key: MINIMIZE_KEY, value: String(on) },
    update: { value: String(on) }
  })
  minimizeToTray = on
  return minimizeToTray
}

/**
 * Writes a copy of the library wherever the user chooses. Resolves to the path,
 * or null when the save dialog is cancelled.
 *
 * `VACUUM INTO` asks SQLite for a consistent snapshot of the live database. A
 * plain file copy would miss whatever is still in the write-ahead log, and ship
 * the user a backup that silently drops their most recent plays.
 */
export async function backup(parent: BrowserWindow | null): Promise<string | null> {
  const name = `symus-library-${new Date().toISOString().slice(0, 10)}.db`
  const options = {
    title: 'Back up library',
    defaultPath: join(app.getPath('documents'), name),
    filters: [{ name: 'SYmuS library', extensions: ['db'] }]
  }
  const { canceled, filePath } = await (parent
    ? dialog.showSaveDialog(parent, options)
    : dialog.showSaveDialog(options))
  if (canceled || !filePath) return null

  // The dialog already asked about overwriting, but VACUUM INTO refuses to
  // write to a file that exists at all.
  rmSync(filePath, { force: true })
  await prisma.$executeRawUnsafe('VACUUM INTO ?', filePath)
  return filePath
}

/** Throws unless `file` is a readable SQLite database with our whole schema in it. */
async function assertIsLibrary(file: string): Promise<void> {
  const probe = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${file}` }) })
  try {
    const rows = await probe.$queryRawUnsafe<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type = 'table'"
    )
    const tables = new Set(rows.map((r) => r.name))
    if (REQUIRED_TABLES.some((t) => !tables.has(t)))
      throw new Error('That file is not a SYmuS library backup.')
  } catch (err) {
    // A non-SQLite file fails at the first read, which is the same answer.
    throw err instanceof Error && err.message.startsWith('That file')
      ? err
      : new Error('That file could not be opened as a SYmuS library backup.')
  } finally {
    await probe.$disconnect()
  }
}

/**
 * Replaces the library with a backup, then relaunches.
 *
 * The order matters: the chosen file is validated while the live database is
 * still untouched, and the current library is only ever moved aside — never
 * deleted — so a failed copy can be put back. Relaunching is what releases the
 * old file handle; swapping the file under a running connection would leave
 * Prisma reading a database that no longer exists.
 *
 * Resolves false when the open dialog is cancelled.
 */
export async function restore(parent: BrowserWindow | null): Promise<boolean> {
  const options = {
    title: 'Restore library from backup',
    properties: ['openFile' as const],
    filters: [{ name: 'SYmuS library', extensions: ['db'] }]
  }
  const { canceled, filePaths } = await (parent
    ? dialog.showOpenDialog(parent, options)
    : dialog.showOpenDialog(options))
  const chosen = filePaths?.[0]
  if (canceled || !chosen) return false

  await assertIsLibrary(chosen)

  const live = dbFile()
  const bak = `${live}.bak`
  await prisma.$disconnect()

  renameSync(live, bak)
  try {
    copyFileSync(chosen, live)
  } catch (err) {
    // Put the user's library back before surfacing the failure. Leaving them
    // with no database at all is the one outcome this function must not have.
    renameSync(bak, live)
    throw err
  }
  // The old connection's journal belongs to the file now sitting in .bak;
  // leaving it beside the restored database would corrupt it on next open.
  for (const suffix of ['-wal', '-shm']) rmSync(live + suffix, { force: true })

  app.relaunch()
  app.quit()
  return true
}

const Flag = z.boolean()

export function registerSettings(ipcMain: IpcMain): void {
  ipcMain.handle('settings:version', () => app.getVersion())
  ipcMain.handle('settings:launchOnStartup', () => launchOnStartup())
  ipcMain.handle('settings:setLaunchOnStartup', (_e, on) => setLaunchOnStartup(Flag.parse(on)))
  ipcMain.handle('settings:minimizeToTray', () => shouldMinimizeToTray())
  ipcMain.handle('settings:setMinimizeToTray', (_e, on) => setMinimizeToTray(Flag.parse(on)))
  // The dialogs are parented to the window that asked, so they cannot end up
  // behind it while modal.
  ipcMain.handle('settings:backup', (e) => backup(BrowserWindow.fromWebContents(e.sender)))
  ipcMain.handle('settings:restore', (e) => restore(BrowserWindow.fromWebContents(e.sender)))
}
