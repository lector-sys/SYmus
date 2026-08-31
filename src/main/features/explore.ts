import type { IpcMain } from 'electron'

/**
 * IPC for explore shelves.
 *
 * Registered from src/main/index.ts via the feature list, so this file is the
 * only place explore shelves touches the main process.
 */
export function registerExplore(ipcMain: IpcMain): void {
  void ipcMain
}
