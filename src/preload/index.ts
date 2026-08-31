import { contextBridge, ipcRenderer } from 'electron'
import type { Track } from '../main/youtube'
import type { SavedTrack, PlaylistSummary } from '../main/library'
import type { MediaCommand } from '../main/tray'

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
  streamUrl: (videoId: string): string => `app://stream/${videoId}`,

  /** Media keys and tray menu clicks arrive here. Returns an unsubscribe. */
  onMedia: (handler: (command: MediaCommand) => void): (() => void) => {
    const listener = (_e: unknown, command: MediaCommand): void => handler(command)
    ipcRenderer.on('media', listener)
    return () => {
      ipcRenderer.off('media', listener)
    }
  },

  /** Pushes what is playing to the tray. Fire-and-forget; main never answers. */
  setNowPlaying: (state: { title: string | null; artist: string | null; playing: boolean }) =>
    ipcRenderer.send('player:state', state),

  lib: {
    /** `hint` is the search query or playlist name — extra text for the genre guess. */
    save: (tracks: Track[], hint?: string | null) => invoke<number[]>('lib:save', tracks, hint),
    play: (track: Track) => invoke<void>('lib:play', track),
    like: (track: Track, liked: boolean) => invoke<boolean>('lib:like', track, liked),
    likes: () => invoke<SavedTrack[]>('lib:likes'),
    recent: (limit?: number) => invoke<SavedTrack[]>('lib:recent', limit),
    top: (limit?: number) => invoke<(SavedTrack & { plays: number })[]>('lib:top', limit),
    recommended: (limit?: number) => invoke<SavedTrack[]>('lib:recommended', limit),

    playlists: () => invoke<PlaylistSummary[]>('lib:playlists'),
    playlistTracks: (id: number) => invoke<SavedTrack[]>('lib:playlistTracks', id),
    playlistCreate: (title: string, tracks?: Track[], genre?: string | null) =>
      invoke<number>('lib:playlistCreate', title, tracks, genre),
    playlistAdd: (id: number, tracks: Track[]) => invoke<number>('lib:playlistAdd', id, tracks),
    playlistRemove: (id: number, videoId: string) =>
      invoke<void>('lib:playlistRemove', id, videoId),
    playlistRename: (id: number, title: string) => invoke<void>('lib:playlistRename', id, title),
    playlistDelete: (id: number) => invoke<void>('lib:playlistDelete', id),
    playlistGenre: (id: number, genre: string | null) =>
      invoke<void>('lib:playlistGenre', id, genre),

    genres: () => invoke<{ genre: string; count: number }[]>('lib:genres'),
    byGenre: (genre: string, limit?: number) => invoke<SavedTrack[]>('lib:byGenre', genre, limit),
    setGenre: (videoId: string, genre: string | null) =>
      invoke<void>('lib:setGenre', videoId, genre)
  }
}

export type Api = typeof api
export type { Track, SavedTrack, PlaylistSummary, MediaCommand }

contextBridge.exposeInMainWorld('api', api)
