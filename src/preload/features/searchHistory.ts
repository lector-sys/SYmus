import { invoke } from '../invoke'
import type { Discovery } from '../../main/features/searchHistory'

/**
 * Renderer-facing API for search: autocomplete, the playlist/artist result
 * tabs, and search history. Owned by that feature alone.
 */
export const searchHistoryApi = {
  /** YouTube's autocomplete. Resolves to [] when it is unavailable. */
  suggest: (query: string) => invoke<string[]>('search:suggest', query),
  /** Playlists or artist channels for a query. Fetched only when a tab is opened. */
  typed: (query: string, kind: 'playlist' | 'artist') =>
    invoke<Discovery[]>('search:typed', query, kind),

  record: (query: string) => invoke<void>('search:record', query),
  recent: (limit?: number) => invoke<string[]>('search:recent', limit),
  clear: () => invoke<void>('search:clear')
}

export type { Discovery }
