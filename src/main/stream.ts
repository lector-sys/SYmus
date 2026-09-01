import { protocol } from 'electron'
import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { audioUrl } from './youtube'
import { cachedFile, type CachedFile } from './features/offline'

/** Must run before app is ready, or <audio> gets no range requests and cannot seek. */
export function registerStreamScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'app',
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
    }
  ])
}

/**
 * Parses a Range header against a known file size.
 *
 * Returns null for "no range / not satisfiable as a range" (serve the whole
 * file) and false when the range is out of bounds (416). All three RFC 7233
 * forms matter here because Chromium uses them all: `bytes=0-` to open the
 * stream, `bytes=N-` to seek, and `bytes=-N` to read trailing metadata, which
 * is how a WebM/MP4 duration gets discovered. Getting the suffix form wrong
 * leaves a track that plays but cannot be seeked.
 */
export function parseRange(
  header: string | null,
  size: number
): { start: number; end: number } | null | false {
  const match = header && /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return null
  const [, from, to] = match
  if (!from && !to) return null

  let start: number
  let end: number
  if (!from) {
    // Suffix: the last N bytes.
    const wanted = Number(to)
    if (wanted <= 0) return false
    start = Math.max(0, size - wanted)
    end = size - 1
  } else {
    start = Number(from)
    end = to ? Number(to) : size - 1
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  if (start >= size || start > end) return false
  return { start, end: Math.min(end, size - 1) }
}

/** Serves a cached file, honouring Range so seeking works exactly as it does over HTTP. */
function serveLocal(file: CachedFile, header: string | null): Response {
  const range = parseRange(header, file.size)

  if (range === false) {
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${file.size}`, 'Accept-Ranges': 'bytes' }
    })
  }

  const body = (start?: number, end?: number): ReadableStream =>
    Readable.toWeb(createReadStream(file.path, { start, end })) as ReadableStream

  if (!range) {
    return new Response(body(), {
      status: 200,
      headers: {
        'Content-Type': file.mime,
        'Content-Length': String(file.size),
        'Accept-Ranges': 'bytes'
      }
    })
  }

  return new Response(body(range.start, range.end), {
    status: 206,
    headers: {
      'Content-Type': file.mime,
      'Content-Length': String(range.end - range.start + 1),
      'Content-Range': `bytes ${range.start}-${range.end}/${file.size}`,
      'Accept-Ranges': 'bytes'
    }
  })
}

/**
 * app://stream/<videoId> -> the video's audio.
 *
 * A cached copy wins outright. That is what makes playback work with no network
 * at all, and it also skips a yt-dlp spawn and a CDN round trip for anything
 * saved for offline. cachedFile() clears rows whose file is missing or the wrong
 * size, so a bad entry falls through to the CDN rather than sticking.
 *
 * Otherwise nothing is written to disk. Range headers pass straight through so
 * <audio> seeks by asking the CDN for the byte window it wants, and returning
 * the upstream body as a WHATWG stream leaves backpressure and cancellation to
 * Electron: when the renderer stops or changes track it aborts the request,
 * request.signal fires, and the upstream socket closes with it.
 */
export function handleStreamProtocol(): void {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url)
    if (url.host !== 'stream') return new Response('not found', { status: 404 })

    const videoId = url.pathname.slice(1)
    if (!/^[\w-]{11}$/.test(videoId)) return new Response('bad video id', { status: 400 })

    const range = request.headers.get('Range')

    try {
      const local = await cachedFile(videoId)
      if (local) return serveLocal(local, range)
    } catch (err) {
      // A cache lookup must never be the reason a track will not play.
      console.error('[stream] cache lookup failed', videoId, err)
    }

    try {
      const upstream = await fetch(await audioUrl(videoId), {
        headers: range ? { Range: range } : {},
        signal: request.signal
      })
      const headers = new Headers(upstream.headers)
      headers.set('Accept-Ranges', 'bytes')
      return new Response(upstream.body, { status: upstream.status, headers })
    } catch (err) {
      if (request.signal.aborted) return new Response(null, { status: 499 })
      const message = err instanceof Error ? err.message : String(err)
      console.error('[stream]', videoId, message)
      // The renderer only sees that the source failed; it asks yt:prepare for the reason.
      return new Response(message, { status: 502 })
    }
  })
}
