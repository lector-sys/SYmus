import type { IpcMain } from 'electron'
import { z } from 'zod'
import { search, type Track } from '../youtube'
import { genres, saveTracks, topArtists } from '../library'

/**
 * IPC for explore shelves.
 *
 * Registered from src/main/index.ts via the feature list, so this file is the
 * only place explore shelves touches the main process.
 *
 * Explore is best-effort discovery built from ordinary YouTube searches. There
 * is no trending API behind it, and the order within a shelf is YouTube's search
 * ranking — it is not a popularity chart, and nothing here should be presented
 * as one.
 */

export interface ExploreShelf {
  id: string
  title: string
  query: string
  /** Genre hint passed to saveTracks, so discovered tracks get tagged. */
  hint: string | null
}

/**
 * A measured yt-dlp search costs ~1.65s. Six shelves is ~10s of work on a cold
 * cache, which is why shelves are fetched one at a time and rendered as each
 * arrives rather than as one blocking page load.
 */
const SHELF_LIMIT = 6
const PER_SHELF = 12

/**
 * Six hours. Search results for "new lo-fi 2026" do not meaningfully change
 * within a day, and a shorter window would spend ~10s of yt-dlp on every second
 * visit for the same rows. Long enough that a day of use costs one cold load,
 * short enough that a "new this year" shelf still turns over.
 */
const TTL_MS = 6 * 60 * 60 * 1000

interface Entry {
  tracks: Track[]
  fetchedAt: number
}

const cache = new Map<string, Entry>()
/** Queries currently being refreshed, so a background refresh cannot stack up. */
const inflight = new Set<string>()

/**
 * Runs work one item at a time.
 *
 * Every shelf is a yt-dlp child process. The renderer requests all its shelves
 * at once so each can render the moment it lands, and without this they would
 * all spawn together — a fistful of concurrent processes and a fast route to
 * being rate limited.
 */
let chain: Promise<unknown> = Promise.resolve()
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn)
  // Swallow rejections on the chain itself: one failed shelf must not poison
  // every shelf queued behind it.
  chain = run.then(
    () => {},
    () => {}
  )
  return run
}

/**
 * Which shelves to show, from what the user actually listens to.
 *
 * Cheap — a couple of grouped queries against SQLite, no network — so the page
 * can lay out its rows immediately and fill them in as they arrive.
 */
export async function planShelves(): Promise<ExploreShelf[]> {
  const [byGenre, byArtist] = await Promise.all([genres(), topArtists(6)])
  const shelves: ExploreShelf[] = []

  const year = new Date().getFullYear()
  for (const { genre } of byGenre.slice(0, 3)) {
    shelves.push({
      id: `genre-new-${genre}`,
      title: `New in ${genre}`,
      query: `new ${genre} music ${year}`,
      hint: genre
    })
  }
  for (const { genre } of byGenre.slice(0, 2)) {
    shelves.push({
      id: `genre-best-${genre}`,
      title: `Essential ${genre}`,
      query: `best ${genre} songs`,
      hint: genre
    })
  }
  for (const { artist } of byArtist.slice(0, 2)) {
    shelves.push({
      id: `artist-${artist}`,
      title: `More like ${artist}`,
      query: `${artist} similar artists songs`,
      hint: null
    })
  }

  // Nothing in the library yet, or too little to fill the page. A fixed set at
  // least gives a new user something to press.
  const generic: ExploreShelf[] = [
    { id: 'g-new', title: `Fresh this year`, query: `new music ${year}`, hint: null },
    { id: 'g-chill', title: 'Something calm', query: 'chill music mix', hint: 'Lo-fi' },
    { id: 'g-focus', title: 'For focus', query: 'focus instrumental music', hint: 'Ambient' },
    { id: 'g-energy', title: 'Pick up the pace', query: 'upbeat energetic songs', hint: null }
  ]
  for (const shelf of generic) {
    if (shelves.length >= SHELF_LIMIT) break
    shelves.push(shelf)
  }

  return shelves.slice(0, SHELF_LIMIT)
}

/** Fetches one shelf and files whatever it finds into the library. */
async function fetchShelf(query: string, hint: string | null): Promise<Track[]> {
  const tracks = await search(query, PER_SHELF)
  if (tracks.length) {
    // Saved the same way a manual search saves, so Explore grows the library
    // rather than showing results that vanish when the page closes.
    await saveTracks(tracks, hint ?? query)
  }
  cache.set(query, { tracks, fetchedAt: Date.now() })
  return tracks
}

/**
 * Cached shelf contents.
 *
 * Stale entries are served immediately and refreshed behind the request, so a
 * revisit after the TTL is instant rather than a ten-second wait for rows the
 * user has already seen.
 */
export async function loadShelf(query: string, hint: string | null): Promise<Track[]> {
  const hit = cache.get(query)
  if (hit) {
    if (Date.now() - hit.fetchedAt > TTL_MS && !inflight.has(query)) {
      inflight.add(query)
      void serial(() => fetchShelf(query, hint))
        .catch(() => {
          /* the stale copy stands until the next attempt */
        })
        .finally(() => inflight.delete(query))
    }
    return hit.tracks
  }
  return serial(() => fetchShelf(query, hint))
}

export function registerExplore(ipcMain: IpcMain): void {
  const Query = z.string().trim().min(1).max(200)
  const Hint = z.string().trim().max(60).nullable().catch(null)

  ipcMain.handle('explore:plan', () => planShelves())
  ipcMain.handle('explore:shelf', (_e, query, hint) =>
    loadShelf(Query.parse(query), Hint.parse(hint))
  )
  // Drops the cache so the next visit refetches. The rows themselves reload on
  // demand; nothing is prefetched here.
  ipcMain.handle('explore:clearCache', () => {
    cache.clear()
    return true
  })
}
