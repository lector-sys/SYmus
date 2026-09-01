import type { IpcMain } from 'electron'
import { z } from 'zod'
import { channelUploads, searchEntries, type Track } from '../youtube'
import { saveTracks } from '../library'
import { prisma } from '../db'

/**
 * IPC for the Podcasts tab.
 *
 * There is no podcast directory behind this. It is the same yt-dlp search the
 * rest of the app uses, pointed at talk-shaped queries, and what comes back is
 * whatever YouTube ranks for them. The tab says so. What makes it a podcast tab
 * rather than a search box is that results are tagged `contentType: 'podcast'`
 * so they stay out of the music shelves, and that channels can be followed.
 */

/** Talk-shaped seed queries. Music words are avoided; "episode" and "interview" carry it. */
const SEEDS = [
  'podcast full episode',
  'long form interview podcast',
  'tech podcast episode',
  'history podcast episode',
  'science podcast full episode',
  'comedy podcast episode'
]

const PER_SHELF = 12

/** Six hours, matching the explore shelves: talk uploads do not turn over faster. */
const TTL_MS = 6 * 60 * 60 * 1000

interface Entry {
  tracks: Track[]
  fetchedAt: number
}
const cache = new Map<string, Entry>()

/**
 * yt-dlp is a child process per call, so podcast fetches queue behind each other
 * exactly as the explore shelves do. This chain is the tab's own; running it
 * against the same one as Explore would make opening this tab wait on a page the
 * user has left.
 */
let chain: Promise<unknown> = Promise.resolve()
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn)
  chain = run.then(
    () => {},
    () => {}
  )
  return run
}

/** The seed query for today, rotated so the tab is not the same six rows forever. */
export function seedForDay(day = new Date()): string {
  // Day of year, so it moves once a day rather than per visit — a shelf that
  // reshuffles while you are reading it is worse than one that does not.
  const start = Date.UTC(day.getUTCFullYear(), 0, 0)
  const index = Math.floor((day.getTime() - start) / 86_400_000) % SEEDS.length
  return SEEDS[index]
}

/**
 * Files tracks as podcasts.
 *
 * saveTracks is the one path that writes tracks, and it knows nothing about
 * content types — so the tag goes on afterwards, by videoId. Everything the
 * Podcasts tab surfaces goes through here, which is what keeps talk uploads out
 * of the music shelves without a second table.
 */
async function saveAsPodcasts(tracks: Track[]): Promise<void> {
  if (!tracks.length) return
  await saveTracks(tracks, null)
  await prisma.track.updateMany({
    where: { videoId: { in: tracks.map((t) => t.videoId) } },
    data: { contentType: 'podcast' }
  })
}

/** videoId -> the channel that uploaded it, learned from search results. */
const channelIndex = new Map<string, { channelId: string; name: string }>()

export interface PodcastResult {
  /** The query these came from, shown so the row never looks like a curated feed. */
  query: string
  tracks: Track[]
  /** Channels seen in these results, for the follow chips. */
  channels: { channelId: string; name: string }[]
}

/** One shelf of talk uploads, cached like the explore shelves. */
export async function discover(query = seedForDay()): Promise<PodcastResult> {
  const hit = cache.get(query)
  if (hit && Date.now() - hit.fetchedAt < TTL_MS) {
    return { query, tracks: hit.tracks, channels: channelsOf(hit.tracks, channelIndex) }
  }

  const hits = await serial(() => searchEntries(query, PER_SHELF))
  const tracks = hits.map((h) => h.track)
  // Remembered per videoId so the follow chips survive the cache round trip
  // without a second search.
  for (const h of hits) {
    if (h.channelId && h.channelName) {
      channelIndex.set(h.track.videoId, { channelId: h.channelId, name: h.channelName })
    }
  }
  await saveAsPodcasts(tracks)
  cache.set(query, { tracks, fetchedAt: Date.now() })
  return { query, tracks, channels: channelsOf(tracks, channelIndex) }
}

function channelsOf(
  tracks: Track[],
  index: Map<string, { channelId: string; name: string }>
): { channelId: string; name: string }[] {
  const seen = new Map<string, string>()
  for (const t of tracks) {
    const channel = index.get(t.videoId)
    if (channel) seen.set(channel.channelId, channel.name)
  }
  return [...seen].map(([channelId, name]) => ({ channelId, name }))
}

export interface FollowedShelf {
  channelId: string
  name: string
  tracks: Track[]
}

export async function following(): Promise<{ channelId: string; name: string }[]> {
  return prisma.followedChannel.findMany({
    orderBy: { followedAt: 'desc' },
    select: { channelId: true, name: true }
  })
}

export async function follow(channelId: string, name: string): Promise<boolean> {
  await prisma.followedChannel.upsert({
    where: { channelId },
    create: { channelId, name },
    // A channel that renamed itself keeps its row and gains the new name.
    update: { name }
  })
  return true
}

export async function unfollow(channelId: string): Promise<boolean> {
  await prisma.followedChannel.deleteMany({ where: { channelId } })
  return true
}

/**
 * Recent uploads from one followed channel.
 *
 * Cached under the channel id on the same six-hour terms as a search shelf, so
 * flipping to this tab does not spawn a yt-dlp run per followed channel every
 * time.
 */
export async function channelShelf(channelId: string): Promise<Track[]> {
  const key = `channel:${channelId}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.fetchedAt < TTL_MS) return hit.tracks

  const tracks = await serial(() => channelUploads(channelId, PER_SHELF))
  await saveAsPodcasts(tracks)
  cache.set(key, { tracks, fetchedAt: Date.now() })
  return tracks
}

export function registerPodcasts(ipcMain: IpcMain): void {
  const Query = z.string().trim().min(1).max(200).optional()
  // yt-dlp channel ids are "UC" plus 22 url-safe characters.
  const ChannelId = z
    .string()
    .trim()
    .regex(/^[\w-]{10,40}$/)
  const Name = z.string().trim().min(1).max(120)

  ipcMain.handle('podcasts:discover', (_e, query) => discover(Query.parse(query ?? undefined)))
  ipcMain.handle('podcasts:following', () => following())
  ipcMain.handle('podcasts:follow', (_e, channelId, name) =>
    follow(ChannelId.parse(channelId), Name.parse(name))
  )
  ipcMain.handle('podcasts:unfollow', (_e, channelId) => unfollow(ChannelId.parse(channelId)))
  ipcMain.handle('podcasts:channel', (_e, channelId) => channelShelf(ChannelId.parse(channelId)))
}
