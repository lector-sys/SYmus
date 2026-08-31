import { contextBridge, ipcRenderer } from 'electron'
import type { Track } from '../main/youtube'

// ipcRenderer wraps a rejection as "Error invoking remote method 'x': Error: real message".
// Every message from main is already written for a human, so unwrap it once, here.
async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  try {
    return (await ipcRenderer.invoke(channel, ...args)) as T
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(message.replace(/^Error invoking remote method '[^']*':\s*(Error:\s*)?/, ''))
  }
}

// The renderer's entire view of the main process. Everything is a typed invoke;
// nothing from node or electron leaks through.
const api = {
  dbStats: () => invoke<{ tracks: number; playlists: number; likes: number }>('db:stats'),
  search: (query: string) => invoke<Track[]>('yt:search', query),
  resolveUrl: (input: string) =>
    invoke<{ name: string | null; tracks: Track[] }>('yt:resolve', input),
  /** Resolves the stream up front so a failure arrives as a readable reason, not a mute <audio>. */
  prepare: (videoId: string) => invoke<void>('yt:prepare', videoId),
  /** No round trip needed: the protocol handler serves from the cache prepare() warmed. */
  streamUrl: (videoId: string): string => `app://stream/${videoId}`
}

export type Api = typeof api
export type { Track }

contextBridge.exposeInMainWorld('api', api)
