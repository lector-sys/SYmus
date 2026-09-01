import { invoke } from '../invoke'
import type { CachedTrack, CacheSummary, PlaylistCacheResult } from '../../main/features/offline'

/** Renderer-facing API for the offline audio cache. Owned by that feature alone. */
export const offlineApi = {
  /** Cached tracks with their on-disk size, for the Downloaded view. */
  list: () => invoke<CachedTrack[]>('offline:list'),
  /** Total count and bytes — also what the Settings page shows. */
  summary: () => invoke<CacheSummary>('offline:summary'),
  status: (videoId: string) =>
    invoke<{ cached: boolean; bytes: number }>('offline:status', videoId),
  /** Resolves to the cached size. Rejects if the track has never been played. */
  save: (videoId: string) => invoke<number>('offline:save', videoId),
  remove: (videoId: string) => invoke<void>('offline:remove', videoId),
  savePlaylist: (playlistId: number) =>
    invoke<PlaylistCacheResult>('offline:savePlaylist', playlistId),
  /** Resolves to how many entries were dropped. */
  clearAll: () => invoke<number>('offline:clearAll')
}
