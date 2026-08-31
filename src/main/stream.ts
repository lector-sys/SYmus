import { protocol } from 'electron'
import { audioUrl } from './youtube'

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
 * app://stream/<videoId> -> the video's audio, proxied from YouTube's CDN.
 *
 * Nothing is written to disk. Range headers pass straight through so <audio>
 * seeks by asking the CDN for the byte window it wants, and returning the
 * upstream body as a WHATWG stream leaves backpressure and cancellation to
 * Electron: when the renderer stops or changes track it aborts the request,
 * request.signal fires, and the upstream socket closes with it.
 */
export function handleStreamProtocol(): void {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url)
    if (url.host !== 'stream') return new Response('not found', { status: 404 })

    const videoId = url.pathname.slice(1)
    if (!/^[\w-]{11}$/.test(videoId)) return new Response('bad video id', { status: 400 })

    try {
      const range = request.headers.get('Range')
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
