import type { IpcMain } from 'electron'
import { spawn } from 'node:child_process'
import { z } from 'zod'
import ytdlExec from 'youtube-dl-exec'
import { prisma } from '../db'
import { bestThumbnail } from '../youtube'

/**
 * IPC for search: suggestions, the non-video result tabs, and search history.
 *
 * Registered from src/main/index.ts via the feature list, so this file is the
 * only place these touch the main process.
 */

// ponytail: youtube.ts keeps its own private runYtdlp. Duplicated here rather
// than widening that module's surface while several features are in flight;
// collapse the two once the dust settles by exporting the original.
const { YOUTUBE_DL_PATH } = (ytdlExec as unknown as { constants: { YOUTUBE_DL_PATH: string } })
  .constants
const YTDLP = YOUTUBE_DL_PATH.replace('app.asar', 'app.asar.unpacked')

function runYtdlp(args: string[], timeoutMs = 45_000): Promise<string> {
  return new Promise((res, rej) => {
    const child = spawn(YTDLP, args, { windowsHide: true })
    let out = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      rej(new Error('YouTube took too long to respond.'))
    }, timeoutMs)
    child.stdout.on('data', (c) => (out += c))
    child.stderr.on('data', () => {})
    child.on('error', () => {
      clearTimeout(timer)
      rej(new Error('Could not run yt-dlp.'))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) res(out)
      else rej(new Error('YouTube returned nothing for that.'))
    })
  })
}

/** A non-track search result: a playlist or an artist channel. */
export interface Discovery {
  kind: 'playlist' | 'artist'
  id: string
  title: string
  subtitle: string | null
  thumbnailUrl: string
  url: string
}

interface Entry {
  id?: string
  url?: string
  title?: string
  channel?: string
  uploader?: string
  playlist_count?: number
  thumbnails?: { url?: string; width?: number }[]
}

// Suggestions are typed against, so the same prefix arrives repeatedly as the
// user backspaces. A short-lived cache keeps that off the network.
const suggestCache = new Map<string, { at: number; value: string[] }>()
const SUGGEST_TTL = 5 * 60_000

/**
 * YouTube's own autocomplete. No key, no quota.
 *
 * Returns `[query, [suggestions], ...]` as text/javascript, which fetch parses
 * as JSON regardless of the content type. Failures return [] — a missing
 * suggestion list is not worth surfacing as an error while someone is typing.
 */
export async function suggest(query: string): Promise<string[]> {
  const key = query.toLowerCase()
  const hit = suggestCache.get(key)
  if (hit && Date.now() - hit.at < SUGGEST_TTL) return hit.value

  try {
    const res = await fetch(
      `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(query)}`,
      { signal: AbortSignal.timeout(4000) }
    )
    if (!res.ok) return []
    const body = (await res.json()) as [string, string[]]
    const list = Array.isArray(body?.[1]) ? body[1].filter((s) => typeof s === 'string') : []
    suggestCache.set(key, { at: Date.now(), value: list })
    return list
  } catch {
    // Offline, blocked, or rate limited. The renderer falls back to history.
    return []
  }
}

/**
 * Playlists and artist channels for a query.
 *
 * `ytsearch:` returns videos (plus the occasional channel), so these come from
 * the results page instead: playlists appear there as YoutubeTab entries, and
 * `sp=EgIQAg%3D%3D` is YouTube's own "Channel" result filter.
 */
export async function searchTyped(
  query: string,
  kind: 'playlist' | 'artist'
): Promise<Discovery[]> {
  const sp = kind === 'artist' ? '&sp=EgIQAg%3D%3D' : ''
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}${sp}`

  const data = JSON.parse(
    await runYtdlp([
      url,
      '--dump-single-json',
      '--flat-playlist',
      '--no-warnings',
      '--playlist-end',
      '30'
    ])
  ) as { entries?: Entry[] }

  const out: Discovery[] = []
  for (const e of data.entries ?? []) {
    const href = e.url ?? ''
    const isPlaylist = href.includes('/playlist?list=')
    const isChannel = href.includes('/channel/') || href.includes('/@')
    if (kind === 'playlist' && !isPlaylist) continue
    if (kind === 'artist' && !isChannel) continue

    out.push({
      kind,
      id: e.id ?? href,
      title: e.title ?? 'Untitled',
      subtitle:
        kind === 'playlist'
          ? e.playlist_count
            ? `${e.playlist_count} tracks`
            : (e.channel ?? e.uploader ?? null)
          : // "Artist - Topic" channels are YouTube's auto-generated artist pages.
            (e.title ?? '').endsWith('- Topic')
            ? 'Artist channel'
            : 'Channel',
      thumbnailUrl: bestThumbnail(e),
      url: href
    })
  }
  return out
}

/** Records a search. Repeat searches bump the count and move to the top. */
export async function recordSearch(query: string): Promise<void> {
  const q = query.trim()
  if (!q) return
  await prisma.searchQuery.upsert({
    where: { query: q },
    create: { query: q },
    update: { uses: { increment: 1 }, lastUsed: new Date() }
  })
}

export const recentSearches = async (limit = 8): Promise<string[]> =>
  (
    await prisma.searchQuery.findMany({
      orderBy: { lastUsed: 'desc' },
      take: limit,
      select: { query: true }
    })
  ).map((r) => r.query)

export const clearSearches = async (): Promise<void> => {
  await prisma.searchQuery.deleteMany({})
}

const Query = z.string().trim().min(1).max(200)
const Limit = z.number().int().min(1).max(50).catch(8)

export function registerSearchHistory(ipcMain: IpcMain): void {
  ipcMain.handle('search:suggest', (_e, query) => suggest(Query.parse(query)))
  ipcMain.handle('search:typed', (_e, query, kind) =>
    searchTyped(Query.parse(query), z.enum(['playlist', 'artist']).parse(kind))
  )
  ipcMain.handle('search:record', (_e, query) => recordSearch(Query.parse(query)))
  ipcMain.handle('search:recent', (_e, limit) => recentSearches(Limit.parse(limit)))
  ipcMain.handle('search:clear', () => clearSearches())
}
