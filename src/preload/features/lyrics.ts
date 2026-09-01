import { invoke } from '../invoke'
import type { LyricsResult } from '../../main/features/lyrics'

/** Renderer-facing API for lyrics. Owned by that feature alone. */
export const lyricsApi = {
  /**
   * Lyrics for a track, from cache when we have them. Never rejects on a
   * network failure — an unreachable source reads as "none" to the panel.
   */
  get: (track: { videoId: string; title: string; artist: string | null; duration: number }) =>
    invoke<LyricsResult>('lyrics:get', track)
}

export type { LyricsResult }
