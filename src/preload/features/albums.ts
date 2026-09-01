import { ipcRenderer } from 'electron'
import { invoke } from '../invoke'
import type { AlbumSummary, AlbumTrack } from '../../main/features/albums'
import type { Track } from '../../main/youtube'

/** Renderer-facing API for artist and album pages. Owned by that feature alone. */
export const albumsApi = {
  /** Everything known locally about one artist: their albums and their tracks. */
  artist: (artist: string) =>
    invoke<{ albums: AlbumSummary[]; tracks: AlbumTrack[]; untagged: number }>(
      'albums:artist',
      artist
    ),

  tracks: (album: string, artist: string | null) =>
    invoke<AlbumTrack[]>('albums:tracks', album, artist),

  /**
   * Looks up album names on YouTube for this artist's untagged tracks.
   * `onProgress` fires per track, because each one is its own yt-dlp run.
   */
  enrich: (
    artist: string,
    onProgress: (p: { done: number; total: number }) => void
  ): Promise<{ checked: number; updated: number }> => {
    const listener = (_e: unknown, p: { done: number; total: number }): void => onProgress(p)
    ipcRenderer.on('albums:enrich-progress', listener)
    return invoke<{ checked: number; updated: number }>('albums:enrich', artist).finally(() => {
      ipcRenderer.off('albums:enrich-progress', listener)
    })
  },

  /** YouTube results for this artist that are not already in the library. */
  findMore: (artist: string) => invoke<Track[]>('albums:findMore', artist),

  add: (tracks: Track[], hint?: string | null) => invoke<number>('albums:add', tracks, hint)
}

export type { AlbumSummary, AlbumTrack }
