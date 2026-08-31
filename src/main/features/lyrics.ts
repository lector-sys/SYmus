import type { IpcMain } from 'electron'

/**
 * IPC for lyrics.
 *
 * Registered from src/main/index.ts via the feature list, so this file is the
 * only place lyrics touches the main process.
 */
export function registerLyrics(ipcMain: IpcMain): void {
  void ipcMain
}
