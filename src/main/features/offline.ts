import type { IpcMain } from 'electron'

/**
 * IPC for offline audio cache.
 *
 * Registered from src/main/index.ts via the feature list, so this file is the
 * only place offline audio cache touches the main process.
 */
export function registerOffline(ipcMain: IpcMain): void {
  void ipcMain
}
