import { search, resolve, type Track } from './youtube'
import { createPlaylist, saveTracks } from './library'

/**
 * Importing a playlist from Spotify or Apple Music fetches *metadata only* —
 * title, artist, album, order. No audio is ever requested from those services;
 * each track is then resolved against YouTube, which is the only source this app
 * plays from.
 */
export type Source = 'youtube' | 'spotify' | 'apple'

export interface ForeignTrack {
  title: string
  artist: string | null
  album: string | null
}

export interface ImportProgress {
  stage: 'fetching' | 'resolving' | 'done'
  /** 1-based index of the track being resolved. */
  done: number
  total: number
  name: string | null
}

export interface ImportResult {
  playlistId: number
  name: string
  imported: number
  /** Tracks YouTube had no confident match for, so they can be fixed by hand. */
  unmatched: ForeignTrack[]
}

/** Which service a pasted link belongs to. Null when it is not a playlist link we handle. */
export function detectSource(input: string): Source | null {
  let url: URL
  try {
    url = new URL(String(input ?? '').trim())
  } catch {
    return null
  }
  const host = url.hostname.replace(/^www\./, '')
  if (/(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be)$/.test(host)) return 'youtube'
  if (/(^|\.)spotify\.com$/.test(host)) return 'spotify'
  if (host === 'music.apple.com') return 'apple'
  return null
}

/** The playlist id inside a Spotify URL, whether it is a link or a URI. */
export function spotifyPlaylistId(input: string): string | null {
  const uri = /spotify:playlist:([A-Za-z0-9]+)/.exec(input)
  if (uri) return uri[1]
  const link = /\/playlist\/([A-Za-z0-9]+)/.exec(input)
  return link ? link[1] : null
}

/** Storefront and playlist id from an Apple Music URL: /<storefront>/playlist/<slug>/<id>. */
export function applePlaylistRef(input: string): { storefront: string; id: string } | null {
  const m = /music\.apple\.com\/([a-z]{2})\/playlist\/[^/]+\/(pl\.[A-Za-z0-9-]+)/i.exec(input)
  return m ? { storefront: m[1], id: m[2] } : null
}

class NotConfigured extends Error {}

const need = (name: string): string => {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new NotConfigured(
      `${name} is not set. Add it to a .env file next to the app (see .env.example) and restart SYmuS.`
    )
  }
  return value
}

/** True when a source has the credentials it needs. Drives the UI's availability hints. */
export function configured(source: Source): boolean {
  if (source === 'youtube') return true
  if (source === 'spotify') {
    return Boolean(
      process.env.SPOTIFY_CLIENT_ID?.trim() && process.env.SPOTIFY_CLIENT_SECRET?.trim()
    )
  }
  return Boolean(process.env.APPLE_MUSIC_DEVELOPER_TOKEN?.trim())
}

// Client-credentials tokens last an hour. Cached so a 40-track import does not
// re-authenticate per page of results.
let spotifyToken: { value: string; expires: number } | null = null

async function spotifyAuth(): Promise<string> {
  if (spotifyToken && spotifyToken.expires > Date.now()) return spotifyToken.value
  const id = need('SPOTIFY_CLIENT_ID')
  const secret = need('SPOTIFY_CLIENT_SECRET')

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  })
  if (!res.ok) {
    throw new Error(
      res.status === 400 || res.status === 401
        ? 'Spotify rejected those credentials. Check SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET.'
        : `Spotify auth failed (${res.status}).`
    )
  }
  const body = (await res.json()) as { access_token: string; expires_in: number }
  spotifyToken = {
    value: body.access_token,
    expires: Date.now() + (body.expires_in - 60) * 1000
  }
  return spotifyToken.value
}

async function fetchSpotify(input: string): Promise<{ name: string; tracks: ForeignTrack[] }> {
  const id = spotifyPlaylistId(input)
  if (!id) throw new Error('That does not look like a Spotify playlist link.')
  const token = await spotifyAuth()
  const auth = { Authorization: `Bearer ${token}` }

  const meta = await fetch(`https://api.spotify.com/v1/playlists/${id}?fields=name`, {
    headers: auth
  })
  if (meta.status === 404) {
    throw new Error('That Spotify playlist is private or does not exist.')
  }
  if (!meta.ok) throw new Error(`Spotify returned ${meta.status}.`)
  const name = ((await meta.json()) as { name?: string }).name ?? 'Spotify playlist'

  // Paged: 100 per request is the API maximum.
  const tracks: ForeignTrack[] = []
  let url: string | null =
    `https://api.spotify.com/v1/playlists/${id}/tracks?limit=100&fields=next,items(track(name,artists(name),album(name)))`
  while (url) {
    const page: Response = await fetch(url, { headers: auth })
    if (!page.ok) throw new Error(`Spotify returned ${page.status} while reading tracks.`)
    const body = (await page.json()) as {
      next: string | null
      items: {
        track: { name?: string; artists?: { name?: string }[]; album?: { name?: string } } | null
      }[]
    }
    for (const item of body.items ?? []) {
      const t = item?.track
      if (!t?.name) continue // local files and removed tracks come back null
      tracks.push({
        title: t.name,
        artist:
          t.artists
            ?.map((a) => a.name)
            .filter(Boolean)
            .join(', ') || null,
        album: t.album?.name ?? null
      })
    }
    url = body.next
  }
  return { name, tracks }
}

async function fetchApple(input: string): Promise<{ name: string; tracks: ForeignTrack[] }> {
  const ref = applePlaylistRef(input)
  if (!ref) throw new Error('That does not look like an Apple Music playlist link.')
  const token = need('APPLE_MUSIC_DEVELOPER_TOKEN')

  const res = await fetch(
    `https://api.music.apple.com/v1/catalog/${ref.storefront}/playlists/${ref.id}`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      'Apple Music rejected the developer token. It may have expired — they are valid for at most six months.'
    )
  }
  if (res.status === 404) throw new Error('That Apple Music playlist is private or does not exist.')
  if (!res.ok) throw new Error(`Apple Music returned ${res.status}.`)

  const body = (await res.json()) as {
    data?: {
      attributes?: { name?: string }
      relationships?: {
        tracks?: {
          data?: { attributes?: { name?: string; artistName?: string; albumName?: string } }[]
        }
      }
    }[]
  }
  const playlist = body.data?.[0]
  const tracks = (playlist?.relationships?.tracks?.data ?? [])
    .map((d) => d.attributes)
    .filter((a): a is NonNullable<typeof a> => Boolean(a?.name))
    .map((a) => ({
      title: a.name!,
      artist: a.artistName ?? null,
      album: a.albumName ?? null
    }))
  return { name: playlist?.attributes?.name ?? 'Apple Music playlist', tracks }
}

/**
 * Is this YouTube result plausibly the track we asked for?
 *
 * A search always returns something, so without a check every import would look
 * like a total success while quietly filling the playlist with interviews,
 * reactions and covers. Requires the title to carry most of the words from the
 * wanted title, and rejects the formats that are never the song itself.
 */
export function isConfidentMatch(want: ForeignTrack, got: Track): boolean {
  const norm = (s: string): string =>
    s
      .toLowerCase()
      .replace(/\(.*?\)|\[.*?\]/g, ' ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

  const title = norm(got.title)
  const haystack = `${title} ${norm(got.artist ?? '')}`

  // Tested against the RAW title, not the normalised one. These markers almost
  // always sit in brackets — "(Karaoke Version)", "[Instrumental]" — which is
  // exactly what norm() strips, so checking the normalised title never sees them.
  if (
    /\b(reaction|interview|review|explained|tutorial|karaoke|instrumental|cover|remix|sped up|slowed)\b/i.test(
      got.title
    )
  ) {
    return false
  }

  const wanted = norm(want.title)
    .split(' ')
    .filter((w) => w.length > 2)
  if (!wanted.length) return false
  const hits = wanted.filter((w) => title.includes(w)).length
  if (hits / wanted.length < 0.6) return false

  // When we know the artist, at least one distinctive part of the name should
  // appear somewhere — YouTube puts it in either the title or the channel.
  const artistWords = norm(want.artist ?? '')
    .split(' ')
    .filter((w) => w.length > 2)
  if (artistWords.length && !artistWords.some((w) => haystack.includes(w))) return false

  return true
}

/**
 * Imports a playlist from any supported source.
 *
 * YouTube is resolved wholesale by the existing paste-a-URL path. Spotify and
 * Apple Music yield metadata only, so every track is then looked up on YouTube
 * one at a time — which is slow, hence `onProgress`.
 */
export async function importPlaylist(
  input: string,
  onProgress: (p: ImportProgress) => void
): Promise<ImportResult> {
  const source = detectSource(input)
  if (!source) {
    throw new Error('Paste a YouTube, Spotify, or Apple Music playlist link.')
  }

  onProgress({ stage: 'fetching', done: 0, total: 0, name: null })

  if (source === 'youtube') {
    const { name, tracks } = await resolve(input)
    if (!tracks.length) throw new Error('That playlist is empty or unavailable.')
    const title = name ?? 'YouTube playlist'
    await saveTracks(tracks, title)
    const playlistId = await createPlaylist(title, tracks)
    onProgress({ stage: 'done', done: tracks.length, total: tracks.length, name: title })
    return { playlistId, name: title, imported: tracks.length, unmatched: [] }
  }

  const { name, tracks: wanted } =
    source === 'spotify' ? await fetchSpotify(input) : await fetchApple(input)
  if (!wanted.length) throw new Error(`"${name}" has no tracks we can read.`)

  const resolved: Track[] = []
  const unmatched: ForeignTrack[] = []

  for (const [i, want] of wanted.entries()) {
    onProgress({ stage: 'resolving', done: i + 1, total: wanted.length, name })
    // Album is deliberately not in the query: it narrows the search enough that
    // singles and remasters stop matching.
    const query = [want.title, want.artist].filter(Boolean).join(' ')
    try {
      const hits = await search(query, 5)
      const hit = hits.find((h) => isConfidentMatch(want, h))
      if (hit) resolved.push(hit)
      else unmatched.push(want)
    } catch {
      // One failed lookup must not abandon a 200-track import.
      unmatched.push(want)
    }
  }

  if (!resolved.length) {
    throw new Error(`Could not match any of the ${wanted.length} tracks in "${name}" on YouTube.`)
  }

  await saveTracks(resolved, name)
  const playlistId = await createPlaylist(name, resolved)
  onProgress({ stage: 'done', done: wanted.length, total: wanted.length, name })
  return { playlistId, name, imported: resolved.length, unmatched }
}
