import { invoke } from '../invoke'
import type { Track } from '../../main/youtube'
import type { Charts, ExploreShelf, GenreTile } from '../../main/features/explore'

export type { Charts, ExploreShelf, GenreTile }

/** Renderer-facing API for explore. Owned by that feature alone. */
export const exploreApi = {
  /** Which shelves to show. Cheap — reads the library, no network. */
  plan: () => invoke<ExploreShelf[]>('explore:plan'),
  /**
   * One shelf's tracks. Requests are served one at a time in the main process,
   * so calling this for every shelf at once is safe and lets each row render as
   * it arrives.
   */
  shelf: (query: string, hint: string | null) => invoke<Track[]>('explore:shelf', query, hint),
  /** Genres for the moods grid: the tagged ones, then common ones not seen yet. */
  tiles: () => invoke<GenreTile[]>('explore:tiles'),
  /** This library's own play counts, and whether there are enough to mean anything. */
  charts: () => invoke<Charts>('explore:charts'),
  /**
   * Searches YouTube for a genre and files what it finds under it. Resolves to
   * how many tracks now carry the tag, so a sparse genre page can refill itself.
   */
  findMore: (genre: string) => invoke<number>('explore:findMore', genre),
  clearCache: () => invoke<boolean>('explore:clearCache')
}
