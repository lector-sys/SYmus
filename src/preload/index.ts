import { contextBridge, ipcRenderer } from 'electron'
import type { Track } from '../main/youtube'
import type { SavedTrack, PlaylistSummary } from '../main/library'
import type { MediaCommand } from '../main/tray'
import type { ImportProgress, ImportResult, Source } from '../main/import'
import { searchHistoryApi } from './features/searchHistory'
import { lyricsApi } from './features/lyrics'
import { offlineApi } from './features/offline'
import { exploreApi } from './features/explore'
import { albumsApi } from './features/albums'

import { invoke } from './invoke'

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

  /** Which service a pasted link belongs to, and whether its keys are present. */
  detectImport: (input: string) =>
    invoke<{ source: Source | null; configured: boolean }>('import:detect', input),

  /**
   * Imports a playlist. `onProgress` fires while tracks are resolved against
   * YouTube; the returned promise settles when the local playlist exists.
   */
  importPlaylist: (
    input: string,
    onProgress: (p: ImportProgress) => void
  ): Promise<ImportResult> => {
    const listener = (_e: unknown, p: ImportProgress): void => onProgress(p)
    ipcRenderer.on('import:progress', listener)
    return invoke<ImportResult>('import:run', input).finally(() => {
      ipcRenderer.off('import:progress', listener)
    })
  },

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
    /** Resolves to how many other tracks by the same artist were tagged too. */
    setGenre: (videoId: string, genre: string | null) =>
      invoke<number>('lib:setGenre', videoId, genre),
    /** Tracks similar to `seed`, for autoplay and radio. Falls back to YouTube. */
    similar: (seed: Track, exclude: string[], limit?: number) =>
      invoke<SavedTrack[]>('lib:similar', seed, exclude, limit),
    genreCoverage: () => invoke<{ tagged: number; total: number }>('lib:genreCoverage'),
    artists: (limit?: number) => invoke<{ artist: string; count: number }[]>('lib:artists', limit),
    byArtist: (artist: string, limit?: number) =>
      invoke<SavedTrack[]>('lib:byArtist', artist, limit)
  },

  // Feature slices. Each object is owned by one feature.
  searchHistory: searchHistoryApi,
  lyrics: lyricsApi,
  offline: offlineApi,
  explore: exploreApi,
  albums: albumsApi
}

export type Api = typeof api
export type {
  Track,
  SavedTrack,
  PlaylistSummary,
  MediaCommand,
  ImportProgress,
  ImportResult,
  Source
}

contextBridge.exposeInMainWorld('api', api)
