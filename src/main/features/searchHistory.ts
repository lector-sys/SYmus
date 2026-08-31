import type { IpcMain } from 'electron'

/**
 * IPC for search history.
 *
 * Registered from src/main/index.ts via the feature list, so this file is the
 * only place search history touches the main process.
 */
export function registerSearchHistory(ipcMain: IpcMain): void {
  void ipcMain
}
