import type { IpcMain } from 'electron'

/**
 * IPC for artist and album pages.
 *
 * Registered from src/main/index.ts via the feature list, so this file is the
 * only place artist and album pages touches the main process.
 */
export function registerAlbums(ipcMain: IpcMain): void {
  void ipcMain
}
