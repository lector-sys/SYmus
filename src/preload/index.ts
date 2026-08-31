import { contextBridge, ipcRenderer } from 'electron'

// The renderer's entire view of the main process. Everything is a typed invoke;
// nothing from node or electron leaks through.
const api = {
  dbStats: (): Promise<{ tracks: number; playlists: number; likes: number }> =>
    ipcRenderer.invoke('db:stats')
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
