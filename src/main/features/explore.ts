import type { IpcMain } from 'electron'
import { z } from 'zod'
import { search, type Track } from '../youtube'
import { genres, mostPlayed, mostPlayedArtists, saveTracks, topArtists } from '../library'
import type { SavedTrack } from '../library'
import { prisma } from '../db'

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

  // First, so it survives the SHELF_LIMIT slice below and the page opens on it.
  //
  // YouTube search does not expose release type, so this is the same best-effort
  // search every other shelf here runs — seeded with the genre the library leans
  // on hardest. The title says albums and singles because that is what the query
  // asks for, not because the source can tell them apart, which is why the tab
  // says "based on recent uploads" rather than claiming a release calendar.
  const lead = byGenre[0]?.genre ?? null
  shelves.push({
    id: 'new-albums-singles',
    title: 'New albums and singles',
    query: lead ? `new ${lead} albums and singles ${year}` : `new albums and singles ${year}`,
    hint: lead
  })

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

/**
 * Genres offered as tiles even when nothing is tagged with them yet.
 *
 * A grid built only from tagged genres would be empty on a fresh library and
 * could never grow, because the way a genre gets its first track is someone
 * pressing its tile and running Find more. Most of these match a rule in
 * library.ts and so fill themselves in over time; the ones that do not —
 * Devotional, Punjabi, Tamil — only ever arrive through Find more, which is
 * why that path tags what it saves.
 */
const COMMON_GENRES = [
  'Rock',
  'Pop',
  'Hip-hop',
  'Electronic',
  'Classical',
  'Jazz',
  'Lo-fi',
  'R&B',
  'Metal',
  'Folk',
  'Country',
  'Latin',
  'Reggae',
  'Ambient',
  'Soundtrack',
  'Bollywood',
  'Indian classical',
  'Devotional',
  'Punjabi',
  'Tamil'
]

export interface GenreTile {
  genre: string
  /** Tracks already tagged with it. Zero means browsable but not yet populated. */
  count: number
}

/**
 * Tiles for the moods and genres grid: what the library actually has, biggest
 * first, then the common genres it does not have yet.
 *
 * Sparse genres are deliberately not hidden. A tile with nothing behind it is
 * the entry point to Find more, not a dead end.
 */
export async function genreTiles(): Promise<GenreTile[]> {
  const tagged = await genres()
  const have = new Set(tagged.map((g) => g.genre.toLowerCase()))
  return [
    ...tagged,
    ...COMMON_GENRES.filter((g) => !have.has(g.toLowerCase())).map((genre) => ({ genre, count: 0 }))
  ]
}

/**
 * Searches YouTube for a genre and files the results under it. Resolves to how
 * many tracks are now tagged with it.
 *
 * saveTracks tags what it can from each title, but a genre with no inference
 * rule — Devotional, Punjabi — would leave every result untagged, and the page
 * the user is standing on would not gain a single row. So anything that came
 * back without a tag is tagged with the genre that was asked for; rows that
 * already carry one keep it, since a specific guess beats the search term.
 *
 * Runs through the same chain as the shelves: one yt-dlp process at a time.
 */
export async function findMoreInGenre(genre: string, limit = 20): Promise<number> {
  const tracks = await serial(() => search(`${genre} music`, limit))
  if (!tracks.length) return 0

  await saveTracks(tracks, genre)
  await prisma.track.updateMany({
    where: { videoId: { in: tracks.map((t) => t.videoId) }, genre: null },
    data: { genre }
  })
  return prisma.track.count({ where: { genre } })
}

export interface Charts {
  tracks: (SavedTrack & { plays: number })[]
  artists: { artist: string; plays: number }[]
  /**
   * Too little listening for the two lists to say anything. The page adds a
   * searched shelf when this is set, clearly marked as coming from search.
   */
  sparse: boolean
}

/**
 * What the Charts tab shows: this library's own play counts.
 *
 * There is no global chart behind any of this and there is no API here that
 * could provide one. Everything below is counted locally, which is what the
 * tab's subtitle says, and the searched supplement is labelled separately so
 * the two can never be mistaken for each other.
 */
export async function charts(): Promise<Charts> {
  const [tracks, artists] = await Promise.all([mostPlayed(12), mostPlayedArtists(12)])
  // Under eight played tracks the ranking is noise — one afternoon of listening
  // ordered by accident. The page still shows it, and adds something to press.
  return { tracks, artists, sparse: tracks.length < 8 }
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

  const Genre = z.string().trim().min(1).max(60)

  ipcMain.handle('explore:plan', () => planShelves())
  ipcMain.handle('explore:tiles', () => genreTiles())
  ipcMain.handle('explore:charts', () => charts())
  ipcMain.handle('explore:findMore', (_e, genre) => findMoreInGenre(Genre.parse(genre)))
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
