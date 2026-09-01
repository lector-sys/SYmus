import { invoke } from '../invoke'
import type { Track } from '../../main/youtube'
import type { ExploreShelf } from '../../main/features/explore'

export type { ExploreShelf }

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
  clearCache: () => invoke<boolean>('explore:clearCache')
}
