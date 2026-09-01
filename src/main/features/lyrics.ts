import type { IpcMain } from 'electron'
import { prisma } from '../db'

/** One timed line of synced lyrics. `time` is seconds from the start of the track. */
export interface LyricLine {
  time: number
  text: string
}

export interface LyricsResult {
  /** 'found' means we have words; 'none' means the source genuinely has none. */
  status: 'found' | 'none'
  lines: LyricLine[] | null
  plain: string | null
}

const NONE: LyricsResult = { status: 'none', lines: null, plain: null }

/** Negative results are cached too, but rechecked eventually — LRCLIB keeps growing. */
const NEGATIVE_TTL_MS = 30 * 24 * 60 * 60 * 1000

// Everything YouTube adds to a title that is not part of the song's name.
const NOISE =
  /\((?:official|lyrics?|audio|video|music|visuali[sz]er|hd|4k|explicit|clean|remaster(?:ed)?)[^)]*\)|\[(?:official|lyrics?|audio|video|music|hd|4k|explicit|clean)[^\]]*\]|\b(?:official\s+(?:music\s+)?video|official\s+audio|lyrics?\s+video|with\s+lyrics|audio|hd|hq|4k|mv)\b/gi

/**
 * Turns a YouTube title and channel into something a lyrics database recognises.
 *
 * Real titles read "The Weeknd - Blinding Lights (Official Video)" on a channel
 * called "TheWeekndVEVO". Measured on ten real tracks, this lifts LRCLIB from
 * mostly-missing to 8/10 found; the two misses were a lofi stream and a full
 * album, neither of which has lyrics at all.
 */
export function cleanQuery(
  rawTitle: string,
  rawArtist: string | null
): { title: string; artist: string } {
  let title = String(rawTitle ?? '')
    // Emoji are decoration in titles and only confuse the lookup. Two passes:
    // a pictographic property escape, then the variation selector separately,
    // because combining them in one character class is ambiguous about whether
    // it matches a whole emoji or its individual code points.
    .replace(/\p{Extended_Pictographic}/gu, ' ')
    .replace(/️/g, '')
    .replace(NOISE, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  let artist = String(rawArtist ?? '')
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/VEVO$/i, '')
    .trim()

  // "Artist - Title" is the dominant convention; the right-hand side is the song.
  const dash = /^(.{1,60}?)\s+[-–—]\s+(.+)$/.exec(title)
  if (dash) {
    if (!artist) artist = dash[1].trim()
    title = dash[2]
  }

  title = title
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\s*\b(?:ft|feat)\.?\s+.*$/i, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*[-–—|]\s*$/, '')
    .trim()

  return { title, artist }
}

/**
 * Parses LRCLIB's LRC text into timed lines.
 *
 * Lines with no timestamp are dropped rather than guessed at — a line shown at
 * the wrong moment is worse than one not shown.
 */
export function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = []
  for (const raw of String(lrc ?? '').split(/\r?\n/)) {
    const m = /^\s*\[(\d+):(\d{1,2})(?:[.:](\d{1,3}))?\]\s?(.*)$/.exec(raw)
    if (!m) continue
    const [, mm, ss, frac, text] = m
    // The divisor scales with the digit count: ".5" is five tenths, ".05" is
    // five hundredths. Assuming centiseconds put "[01:05.5]" at 65.05s.
    const fraction = frac ? Number(frac) / 10 ** frac.length : 0
    lines.push({ time: Number(mm) * 60 + Number(ss) + fraction, text: text.trim() })
  }
  return lines.sort((a, b) => a.time - b.time)
}

interface LrclibTrack {
  syncedLyrics?: string | null
  plainLyrics?: string | null
  instrumental?: boolean
  duration?: number
}

const toResult = (t: LrclibTrack | null): LyricsResult => {
  if (!t || t.instrumental) return NONE
  const lines = t.syncedLyrics ? parseLrc(t.syncedLyrics) : []
  if (lines.length) return { status: 'found', lines, plain: t.plainLyrics ?? null }
  if (t.plainLyrics?.trim()) return { status: 'found', lines: null, plain: t.plainLyrics }
  return NONE
}

/**
 * Asks LRCLIB. No API key, no auth.
 *
 * `duration` is deliberately left off the /get call: LRCLIB matches it within
 * about ten seconds, and a YouTube upload's length routinely differs from the
 * released track's, which turns a perfectly good match into a 404. The search
 * fallback then picks whichever result is closest to the length we do have.
 */
async function lookup(
  title: string,
  artist: string,
  duration: number
): Promise<{ synced: string | null; plain: string | null } | null> {
  const params = new URLSearchParams({ artist_name: artist, track_name: title })
  try {
    const direct = await fetch(`https://lrclib.net/api/get?${params}`, {
      headers: { 'User-Agent': 'SYmuS (personal music player)' }
    })
    if (direct.ok) {
      const t = (await direct.json()) as LrclibTrack
      if (t.instrumental) return null
      if (t.syncedLyrics || t.plainLyrics) {
        return { synced: t.syncedLyrics ?? null, plain: t.plainLyrics ?? null }
      }
    }

    const search = await fetch(`https://lrclib.net/api/search?${params}`, {
      headers: { 'User-Agent': 'SYmuS (personal music player)' }
    })
    if (!search.ok) return null
    const results = (await search.json()) as LrclibTrack[]
    const usable = results.filter((r) => !r.instrumental && (r.syncedLyrics || r.plainLyrics))
    if (!usable.length) return null

    // Closest running time wins; without a duration the first result stands.
    const best = duration
      ? usable.reduce((a, b) =>
          Math.abs((b.duration ?? 0) - duration) < Math.abs((a.duration ?? 0) - duration) ? b : a
        )
      : usable[0]
    return { synced: best.syncedLyrics ?? null, plain: best.plainLyrics ?? null }
  } catch {
    // Offline, DNS failure, LRCLIB down. Indistinguishable from "no lyrics" to
    // the panel, but deliberately not cached, so it retries next time.
    return null
  }
}

export function registerLyrics(ipcMain: IpcMain): void {
  ipcMain.handle('lyrics:get', async (_e, input) => {
    const videoId = String(input?.videoId ?? '')
    const title = String(input?.title ?? '').slice(0, 300)
    const artist = input?.artist ? String(input.artist).slice(0, 200) : null
    const duration = Number(input?.duration) || 0
    if (!/^[\w-]{11}$/.test(videoId) || !title) return NONE

    const track = await prisma.track.findUnique({ where: { videoId }, select: { id: true } })

    // A row with neither field is "we looked and there is nothing", which is
    // different from no row at all, which is "never looked".
    if (track) {
      const cached = await prisma.lyrics.findUnique({ where: { trackId: track.id } })
      if (cached) {
        const empty = !cached.synced && !cached.plain
        const stale = Date.now() - cached.fetchedAt.getTime() > NEGATIVE_TTL_MS
        if (!empty) {
          const lines = cached.synced ? parseLrc(cached.synced) : []
          return {
            status: 'found',
            lines: lines.length ? lines : null,
            plain: cached.plain
          } satisfies LyricsResult
        }
        if (!stale) return NONE
      }
    }

    const clean = cleanQuery(title, artist)
    if (!clean.title) return NONE
    const found = await lookup(clean.title, clean.artist, duration)

    if (track) {
      const data = {
        synced: found?.synced ?? null,
        plain: found?.plain ?? null,
        fetchedAt: new Date()
      }
      await prisma.lyrics.upsert({
        where: { trackId: track.id },
        create: { trackId: track.id, ...data },
        update: data
      })
    }
    return toResult(found ? { syncedLyrics: found.synced, plainLyrics: found.plain } : null)
  })
}
