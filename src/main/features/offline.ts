import { app, type IpcMain } from 'electron'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { z } from 'zod'
import { prisma } from '../db'
import { audioUrl } from '../youtube'
import type { SavedTrack } from '../library'

const VideoId = z.string().regex(/^[\w-]{11}$/)
const Id = z.number().int().positive()

/** Cached audio lives beside the database, under userData. */
export const cacheDir = (): string => join(app.getPath('userData'), 'audio-cache')

/**
 * yt-dlp asks for `bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio`, so in
 * practice the CDN hands back one of these two. The extension is the only place
 * the container is recorded — there is no column for it — so it has to be
 * derivable back into a MIME type when the file is served.
 */
const EXTENSIONS: [RegExp, string][] = [
  [/webm/i, '.webm'],
  [/mp4|m4a|aac/i, '.m4a'],
  [/ogg|opus/i, '.opus']
]
const MIME: Record<string, string> = {
  '.webm': 'audio/webm',
  '.m4a': 'audio/mp4',
  '.opus': 'audio/ogg'
}

const extensionFor = (contentType: string | null): string =>
  EXTENSIONS.find(([re]) => re.test(contentType ?? ''))?.[1] ?? '.webm'

export const mimeFor = (path: string): string =>
  MIME[path.slice(path.lastIndexOf('.')).toLowerCase()] ?? 'audio/webm'

export interface CachedFile {
  path: string
  size: number
  mime: string
}

/**
 * The cached file for a track, or null when there is not a usable one.
 *
 * A row can point at a file that no longer exists, or at one whose size no
 * longer matches what was recorded. Both are treated as "not cached" and the
 * row is cleared, so a half-written or externally-deleted file self-heals into
 * a normal CDN stream rather than playing as silence forever.
 */
export async function cachedFile(videoId: string): Promise<CachedFile | null> {
  const track = await prisma.track.findUnique({
    where: { videoId },
    select: { id: true, cachedPath: true, cachedBytes: true }
  })
  if (!track?.cachedPath) return null

  try {
    const info = await stat(track.cachedPath)
    if (!info.isFile() || info.size === 0) throw new Error('not a usable file')
    if (track.cachedBytes && info.size !== track.cachedBytes) throw new Error('size mismatch')
    return { path: track.cachedPath, size: info.size, mime: mimeFor(track.cachedPath) }
  } catch {
    await prisma.track.update({
      where: { id: track.id },
      data: { cachedPath: null, cachedBytes: null }
    })
    return null
  }
}

const CHUNK = 8 * 1024 * 1024

/**
 * Pulls a URL to disk a chunk at a time.
 *
 * googlevideo throttles a single long GET down to roughly playback speed — an
 * 80 MB upload arrived at 35 KB/s — so saving a track would take as long as
 * hearing it. Every fresh ranged request gets an unthrottled burst instead, and
 * a burst comfortably covers a chunk this size.
 */
async function downloadInChunks(
  url: string,
  path: string
): Promise<{ bytes: number; contentType: string | null }> {
  let at = 0
  let total: number | null = null
  let contentType: string | null = null

  do {
    const last = at + CHUNK - 1
    const response = await fetch(url, { headers: { Range: `bytes=${at}-${last}` } })
    if (!response.ok || !response.body) {
      throw new Error(`YouTube returned ${response.status} for that audio.`)
    }
    contentType ??= response.headers.get('content-type')
    // "bytes 0-8388607/81065857" — the tail is the size of the whole file. A
    // server that ignored the range answers 200 with no such header, and has
    // just sent everything, which ends the loop on its own.
    total ??= Number(response.headers.get('content-range')?.split('/')[1]) || null
    // A fresh handle per chunk. One shared stream kept across pipeline() calls
    // collects another set of listeners with every chunk.
    await pipeline(
      Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
      createWriteStream(path, { flags: at === 0 ? 'w' : 'a' })
    )
    at = last + 1
  } while (total !== null && at < total)

  const bytes = (await stat(path)).size
  // A chunk cut short by the CDN would otherwise be stored as a complete track
  // and play as one, silently missing its end.
  if (total !== null && bytes !== total) {
    throw new Error(`That download stopped early (${bytes} of ${total} bytes).`)
  }
  return { bytes, contentType }
}

// Two "save for offline" clicks on the same track would otherwise race for the
// same .part file. Callers share one download instead.
const inFlight = new Map<string, Promise<number>>()

/**
 * Downloads a track's audio to disk and records it. Resolves to the byte size.
 *
 * Only tracks that have actually been played can be cached. That check is what
 * keeps this a convenience cache of audio the user already streamed rather than
 * a download manager.
 */
export async function cacheTrack(videoId: string): Promise<number> {
  const existing = inFlight.get(videoId)
  if (existing) return existing

  const run = (async (): Promise<number> => {
    const already = await cachedFile(videoId)
    if (already) return already.size

    const track = await prisma.track.findUnique({
      where: { videoId },
      select: { id: true, title: true }
    })
    if (!track) throw new Error('That track is not in your library yet.')

    const plays = await prisma.historyEntry.count({ where: { trackId: track.id } })
    if (!plays) {
      throw new Error('Play it once first — offline keeps audio you have already listened to.')
    }

    const directory = cacheDir()
    await mkdir(directory, { recursive: true })
    const partial = join(directory, `${videoId}.part`)

    let final: string
    try {
      const got = await downloadInChunks(await audioUrl(videoId), partial)
      final = join(directory, `${videoId}${extensionFor(got.contentType)}`)
      // Renamed only once complete, so a crash mid-download can never leave a
      // truncated file that the player would treat as the whole track.
      await rename(partial, final)
    } catch (err) {
      await rm(partial, { force: true })
      throw err
    }

    const { size } = await stat(final)
    await prisma.track.update({
      where: { id: track.id },
      data: { cachedPath: final, cachedBytes: size }
    })
    return size
  })()

  inFlight.set(videoId, run)
  try {
    return await run
  } finally {
    inFlight.delete(videoId)
  }
}

/** Drops a track's cached audio. Safe when the file is already gone. */
export async function removeCached(videoId: string): Promise<void> {
  const track = await prisma.track.findUnique({
    where: { videoId },
    select: { id: true, cachedPath: true }
  })
  if (!track) return
  // The row is cleared whether or not the unlink succeeds, so a file that
  // vanished underneath us cannot leave the library claiming it is cached.
  if (track.cachedPath) await rm(track.cachedPath, { force: true })
  await prisma.track.update({
    where: { id: track.id },
    data: { cachedPath: null, cachedBytes: null }
  })
}

export interface CacheSummary {
  count: number
  bytes: number
}

export async function cacheSummary(): Promise<CacheSummary> {
  const rows = await prisma.track.aggregate({
    where: { cachedPath: { not: null } },
    _count: { _all: true },
    _sum: { cachedBytes: true }
  })
  return { count: rows._count._all, bytes: rows._sum.cachedBytes ?? 0 }
}

export type CachedTrack = SavedTrack & { bytes: number }

export async function cachedTracks(): Promise<CachedTrack[]> {
  const rows = await prisma.track.findMany({
    where: { cachedPath: { not: null } },
    orderBy: { title: 'asc' },
    select: {
      videoId: true,
      title: true,
      artist: true,
      thumbnailUrl: true,
      duration: true,
      genre: true,
      cachedBytes: true
    }
  })
  return rows.map((r) => ({
    videoId: r.videoId,
    title: r.title,
    artist: r.artist,
    thumbnailUrl: r.thumbnailUrl ?? '',
    duration: r.duration,
    genre: r.genre,
    bytes: r.cachedBytes ?? 0
  }))
}

export async function clearAllCached(): Promise<number> {
  const rows = await prisma.track.findMany({
    where: { cachedPath: { not: null } },
    select: { videoId: true }
  })
  for (const r of rows) await removeCached(r.videoId)
  // Sweeps any .part files a crash left behind.
  await rm(cacheDir(), { recursive: true, force: true })
  return rows.length
}

export interface PlaylistCacheResult {
  cached: number
  /** Tracks skipped because they have never been played. */
  skipped: number
  failed: { title: string; reason: string }[]
}

/** Caches every already-played track in a playlist, reporting what it could not take. */
export async function cachePlaylist(playlistId: number): Promise<PlaylistCacheResult> {
  const rows = await prisma.playlistTrack.findMany({
    where: { playlistId },
    orderBy: { position: 'asc' },
    select: { track: { select: { videoId: true, title: true } } }
  })

  const result: PlaylistCacheResult = { cached: 0, skipped: 0, failed: [] }
  for (const { track } of rows) {
    try {
      await cacheTrack(track.videoId)
      result.cached++
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      // "Never played" is the expected outcome for most of a playlist, not a
      // failure worth listing next to a genuine network error.
      if (reason.startsWith('Play it once first')) result.skipped++
      else result.failed.push({ title: track.title, reason })
    }
  }
  return result
}

export function registerOffline(ipcMain: IpcMain): void {
  ipcMain.handle('offline:list', () => cachedTracks())
  ipcMain.handle('offline:summary', () => cacheSummary())
  ipcMain.handle('offline:status', async (_e, videoId) => {
    const file = await cachedFile(VideoId.parse(videoId))
    return { cached: Boolean(file), bytes: file?.size ?? 0 }
  })
  ipcMain.handle('offline:save', (_e, videoId) => cacheTrack(VideoId.parse(videoId)))
  ipcMain.handle('offline:remove', (_e, videoId) => removeCached(VideoId.parse(videoId)))
  ipcMain.handle('offline:savePlaylist', (_e, id) => cachePlaylist(Id.parse(id)))
  ipcMain.handle('offline:clearAll', () => clearAllCached())
}
