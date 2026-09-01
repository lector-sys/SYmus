import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { spawn } from 'node:child_process'
import ytdlExec from 'youtube-dl-exec'
import { z } from 'zod'
import { prisma } from '../db'
import { search, type Track } from '../youtube'
import { saveTracks } from '../library'

// Same resolution the rest of the app uses: a packaged app cannot exec from
// inside the asar, so electron-builder unpacks the binary.
const { YOUTUBE_DL_PATH } = (ytdlExec as unknown as { constants: { YOUTUBE_DL_PATH: string } })
  .constants
const YTDLP = YOUTUBE_DL_PATH.replace('app.asar', 'app.asar.unpacked')

export interface AlbumTrack {
  videoId: string
  title: string
  artist: string | null
  album: string | null
  thumbnailUrl: string
  duration: number
  genre: string | null
}

export interface AlbumSummary {
  name: string
  count: number
  coverUrl: string | null
}

const SELECT = {
  videoId: true,
  title: true,
  artist: true,
  album: true,
  thumbnailUrl: true,
  duration: true,
  genre: true
} as const

const toTrack = (r: {
  videoId: string
  title: string
  artist: string | null
  album: string | null
  thumbnailUrl: string | null
  duration: number
  genre: string | null
}): AlbumTrack => ({ ...r, thumbnailUrl: r.thumbnailUrl ?? '' })

const Artist = z.string().trim().min(1).max(300)
const Album = z.string().trim().min(1).max(300)

/**
 * What we know about one artist: their albums, and everything that is not on a
 * known album.
 *
 * Album is null for most rows because YouTube only exposes it on its
 * auto-generated music uploads — see enrichAlbums below. So the page is built
 * around "tracks", with albums as a bonus section when the data exists, rather
 * than assuming every track belongs to one.
 */
async function artistOverview(artist: string): Promise<{
  albums: AlbumSummary[]
  tracks: AlbumTrack[]
  untagged: number
}> {
  const rows = await prisma.track.findMany({
    where: { artist },
    orderBy: { addedAt: 'asc' },
    select: SELECT
  })

  const byAlbum = new Map<string, AlbumTrack[]>()
  for (const r of rows) {
    if (!r.album) continue
    const list = byAlbum.get(r.album) ?? []
    list.push(toTrack(r))
    byAlbum.set(r.album, list)
  }

  return {
    albums: [...byAlbum.entries()]
      .map(([name, list]) => ({
        name,
        count: list.length,
        coverUrl: list.find((t) => t.thumbnailUrl)?.thumbnailUrl ?? null
      }))
      .sort((a, b) => b.count - a.count),
    tracks: rows.map(toTrack),
    untagged: rows.filter((r) => !r.album).length
  }
}

/** Runs yt-dlp and parses one JSON object. Resolves null on any failure. */
function ytdlpJson(videoId: string): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const child = spawn(
      YTDLP,
      [
        `https://www.youtube.com/watch?v=${videoId}`,
        '--dump-single-json',
        '--skip-download',
        '--no-warnings',
        '--no-playlist'
      ],
      { windowsHide: true }
    )
    let out = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), 30_000)
    child.stdout.on('data', (c) => (out += c))
    child.on('error', () => {
      clearTimeout(timer)
      resolve(null)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) return resolve(null)
      try {
        resolve(JSON.parse(out))
      } catch {
        resolve(null)
      }
    })
  })
}

/**
 * Fills in album names for an artist's tracks.
 *
 * YouTube exposes album/artist/track only on the auto-generated uploads that
 * come from its music catalogue — verified: a Topic-style upload returns
 * `album: "After Hours"`, while the same song's "(Official Audio)" upload
 * returns nothing at all. So this can only ever tag a subset, and that is a
 * property of the source, not of this code.
 *
 * ponytail: one yt-dlp process per track, sequential, capped per call. It is a
 * few seconds each, which is why this is an explicit user action with progress
 * rather than something that runs on import. Batch it if that ever matters.
 */
async function enrichAlbums(
  artist: string,
  onProgress: (done: number, total: number) => void,
  cap = 25
): Promise<{ checked: number; updated: number }> {
  const pending = await prisma.track.findMany({
    where: { artist, album: null },
    orderBy: { addedAt: 'asc' },
    take: cap,
    select: { videoId: true }
  })

  let updated = 0
  for (const [i, row] of pending.entries()) {
    onProgress(i + 1, pending.length)
    const meta = await ytdlpJson(row.videoId)
    const album = typeof meta?.album === 'string' ? meta.album.trim() : ''
    if (!album) continue
    await prisma.track.updateMany({ where: { videoId: row.videoId }, data: { album } })
    updated++
  }
  return { checked: pending.length, updated }
}

export function registerAlbums(ipcMain: IpcMain): void {
  ipcMain.handle('albums:artist', (_e, artist) => artistOverview(Artist.parse(artist)))

  ipcMain.handle('albums:tracks', async (_e, album, artist) => {
    const rows = await prisma.track.findMany({
      where: {
        album: Album.parse(album),
        ...(artist ? { artist: Artist.parse(artist) } : {})
      },
      // No track-number column exists, so insertion order is the closest thing
      // to the album's own running order.
      orderBy: { addedAt: 'asc' },
      select: SELECT
    })
    return rows.map(toTrack)
  })

  ipcMain.handle('albums:enrich', (event: IpcMainInvokeEvent, artist) =>
    enrichAlbums(Artist.parse(artist), (done, total) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('albums:enrich-progress', { done, total })
      }
    })
  )

  // Deliberately does not save: the user picks what to add, so results are
  // offered first and only chosen tracks enter the library.
  ipcMain.handle('albums:findMore', async (_e, artist) => {
    const name = Artist.parse(artist)
    const found = await search(`${name} songs`, 20)
    const known = new Set(
      (
        await prisma.track.findMany({
          where: { videoId: { in: found.map((t) => t.videoId) } },
          select: { videoId: true }
        })
      ).map((r) => r.videoId)
    )
    return found.filter((t) => !known.has(t.videoId))
  })

  ipcMain.handle('albums:add', async (_e, tracks, hint) => {
    const parsed = z
      .array(
        z.object({
          videoId: z.string().regex(/^[\w-]{11}$/),
          title: z.string().min(1).max(500),
          artist: z.string().max(300).nullable().catch(null),
          thumbnailUrl: z.string().max(2000).catch(''),
          duration: z.number().int().min(0).max(86_400).catch(0)
        })
      )
      .min(1)
      .max(100)
      .parse(tracks)
    const ids = await saveTracks(
      parsed as Track[],
      hint == null ? null : String(hint).slice(0, 200)
    )
    return ids.length
  })
}
