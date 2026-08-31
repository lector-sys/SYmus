import { prisma } from './db'
import type { Track } from './youtube'

export type SavedTrack = Track & { genre: string | null }

/**
 * Keyword -> genre, first match wins. Order matters: the specific patterns sit
 * above the ones that would swallow them ("lofi hip hop" is lofi, not hip hop).
 *
 * ponytail: a lookup table, not a classifier. Every track is manually
 * re-taggable in the UI, which is the escape hatch when this guesses wrong.
 */
const GENRE_RULES: [string, RegExp][] = [
  ['Lo-fi', /\blo-?fi\b|chillhop|study beats/i],
  ['Classical', /\bclassical\b|symphony|concerto|sonata|orchestra|beethoven|mozart|chopin|bach\b/i],
  ['Jazz', /\bjazz\b|bebop|swing band|saxophone|blue note/i],
  ['Metal', /\bmetal\b|metalcore|deathcore|thrash/i],
  ['Rock', /\brock\b|punk|grunge|alt(ernative)?[- ]rock|indie rock|guitar solo/i],
  ['Hip-hop', /\bhip[- ]?hop\b|\brap\b|\btrap\b|drill\b|freestyle/i],
  ['R&B', /\br ?& ?b\b|rhythm and blues|neo[- ]soul|\bsoul\b/i],
  ['Electronic', /\bedm\b|house\b|techno|trance|dubstep|drum ?& ?bass|\bdnb\b|synthwave|electro/i],
  ['Pop', /\bpop\b|top ?40|k-?pop|j-?pop/i],
  ['Bollywood', /bollywood|hindi song|arijit|shreya ghoshal|\bfilmi\b/i],
  ['Indian classical', /carnatic|hindustani|raag|raga\b|bhajan|ghazal|qawwali/i],
  ['Country', /\bcountry\b|bluegrass|honky tonk/i],
  ['Folk', /\bfolk\b|acoustic|singer[- ]songwriter/i],
  ['Latin', /reggaeton|salsa|bachata|latin\b|cumbia/i],
  ['Reggae', /\breggae\b|dancehall|ska\b/i],
  ['Ambient', /\bambient\b|meditation|white noise|sleep music|rain sounds/i],
  ['Soundtrack', /soundtrack|\bost\b|original score|theme song|\bbgm\b/i]
]

/** Best-effort genre for a track, from whatever text we have. Null when nothing matches. */
export function inferGenre(...text: (string | null | undefined)[]): string | null {
  const blob = text.filter(Boolean).join(' ')
  if (!blob.trim()) return null
  return GENRE_RULES.find(([, re]) => re.test(blob))?.[0] ?? null
}

interface Row {
  videoId: string
  title: string
  artist: string | null
  thumbnailUrl: string | null
  duration: number
  genre: string | null
}

const toSaved = (r: Row): SavedTrack => ({
  videoId: r.videoId,
  title: r.title,
  artist: r.artist,
  thumbnailUrl: r.thumbnailUrl ?? '',
  duration: r.duration,
  genre: r.genre
})

const SELECT = {
  videoId: true,
  title: true,
  artist: true,
  thumbnailUrl: true,
  duration: true,
  genre: true
} as const

/**
 * Rows for these videoIds, creating what is missing. `hint` is the search query or
 * playlist name the tracks arrived with — extra text for the genre guess.
 *
 * An existing row keeps its genre: an inferred guess must never overwrite a tag
 * the user set by hand.
 */
export async function saveTracks(tracks: Track[], hint?: string | null): Promise<number[]> {
  const ids: number[] = []
  for (const t of tracks) {
    if (!t?.videoId) continue
    // The track's own text decides first; the hint is only a fallback. Blending
    // them lets a "jazz essentials" search tag a metal track Jazz, because the
    // winner would be whichever rule sits higher in the table, not which text matched.
    const genre = inferGenre(t.title, t.artist) ?? inferGenre(hint)
    const row = await prisma.track.upsert({
      where: { videoId: t.videoId },
      create: {
        videoId: t.videoId,
        title: t.title,
        artist: t.artist,
        thumbnailUrl: t.thumbnailUrl,
        duration: t.duration,
        genre
      },
      update: { title: t.title, artist: t.artist, thumbnailUrl: t.thumbnailUrl },
      select: { id: true }
    })
    if (genre) {
      await prisma.track.updateMany({ where: { id: row.id, genre: null }, data: { genre } })
    }
    ids.push(row.id)
  }
  return ids
}

const oneId = async (track: Track, hint?: string | null): Promise<number> =>
  (await saveTracks([track], hint))[0]

/** Records a play. Also saves the track, so anything played is in the library. */
export async function recordPlay(track: Track): Promise<void> {
  const trackId = await oneId(track)
  await prisma.historyEntry.create({ data: { trackId } })
}

export async function setLiked(track: Track, liked: boolean): Promise<boolean> {
  const trackId = await oneId(track)
  if (liked) await prisma.like.upsert({ where: { trackId }, create: { trackId }, update: {} })
  else await prisma.like.deleteMany({ where: { trackId } })
  return liked
}

export async function likedTracks(): Promise<SavedTrack[]> {
  const rows = await prisma.like.findMany({
    orderBy: { likedAt: 'desc' },
    select: { track: { select: SELECT } }
  })
  return rows.map((r) => toSaved(r.track))
}

// findMany returns rows in whatever order it likes; the ranking lives in the id list.
async function orderedRows(ids: number[]): Promise<({ id: number } & Row)[]> {
  if (!ids.length) return []
  const rows = await prisma.track.findMany({
    where: { id: { in: ids } },
    select: { id: true, ...SELECT }
  })
  const byId = new Map(rows.map((r) => [r.id, r]))
  return ids.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => Boolean(r))
}

/** Distinct tracks, most recently played first — a raw play log would repeat the same song. */
export async function recentlyPlayed(limit = 20): Promise<SavedTrack[]> {
  const groups = await prisma.historyEntry.groupBy({
    by: ['trackId'],
    _max: { playedAt: true },
    orderBy: { _max: { playedAt: 'desc' } },
    take: limit
  })
  return (await orderedRows(groups.map((g) => g.trackId))).map(toSaved)
}

export async function mostPlayed(limit = 20): Promise<(SavedTrack & { plays: number })[]> {
  const groups = await prisma.historyEntry.groupBy({
    by: ['trackId'],
    _count: { trackId: true },
    orderBy: { _count: { trackId: 'desc' } },
    take: limit
  })
  const plays = new Map(groups.map((g) => [g.trackId, g._count.trackId]))
  const rows = await orderedRows(groups.map((g) => g.trackId))
  return rows.map((r) => ({ ...toSaved(r), plays: plays.get(r.id) ?? 0 }))
}

export interface PlaylistSummary {
  id: number
  title: string
  coverUrl: string | null
  genre: string | null
  count: number
}

export async function playlists(): Promise<PlaylistSummary[]> {
  const rows = await prisma.playlist.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      coverUrl: true,
      genre: true,
      _count: { select: { tracks: true } }
    }
  })
  return rows.map(({ _count, ...p }) => ({ ...p, count: _count.tracks }))
}

export async function playlistTracks(id: number): Promise<SavedTrack[]> {
  const rows = await prisma.playlistTrack.findMany({
    where: { playlistId: id },
    orderBy: { position: 'asc' },
    select: { track: { select: SELECT } }
  })
  return rows.map((r) => toSaved(r.track))
}

export async function createPlaylist(
  title: string,
  tracks: Track[] = [],
  genre?: string | null
): Promise<number> {
  const playlist = await prisma.playlist.create({
    data: {
      title,
      genre: genre ?? inferGenre(title),
      coverUrl: tracks[0]?.thumbnailUrl ?? null
    },
    select: { id: true }
  })
  if (tracks.length) await addToPlaylist(playlist.id, tracks)
  return playlist.id
}

/** Appends, skipping tracks already in the playlist. Position continues from the end. */
export async function addToPlaylist(playlistId: number, tracks: Track[]): Promise<number> {
  const playlist = await prisma.playlist.findUnique({
    where: { id: playlistId },
    select: { title: true, coverUrl: true }
  })
  if (!playlist) throw new Error('That playlist no longer exists.')

  const ids = await saveTracks(tracks, playlist.title)
  const last = await prisma.playlistTrack.findFirst({
    where: { playlistId },
    orderBy: { position: 'desc' },
    select: { position: true }
  })
  let position = (last?.position ?? -1) + 1

  // (playlistId, trackId) is the primary key, so a re-add would be a constraint
  // error. Filter first — SQLite has no skipDuplicates.
  const present = new Set(
    (
      await prisma.playlistTrack.findMany({
        where: { playlistId, trackId: { in: ids } },
        select: { trackId: true }
      })
    ).map((r) => r.trackId)
  )
  const fresh = [...new Set(ids)].filter((id) => !present.has(id))
  if (fresh.length) {
    await prisma.playlistTrack.createMany({
      data: fresh.map((trackId) => ({ playlistId, trackId, position: position++ }))
    })
  }
  const added = fresh.length
  if (!playlist.coverUrl && tracks[0]?.thumbnailUrl) {
    await prisma.playlist.update({
      where: { id: playlistId },
      data: { coverUrl: tracks[0].thumbnailUrl }
    })
  }
  return added
}

export async function removeFromPlaylist(playlistId: number, videoId: string): Promise<void> {
  const track = await prisma.track.findUnique({ where: { videoId }, select: { id: true } })
  if (!track) return
  await prisma.playlistTrack.deleteMany({ where: { playlistId, trackId: track.id } })
}

export async function renamePlaylist(id: number, title: string): Promise<void> {
  await prisma.playlist.update({ where: { id }, data: { title } })
}

export async function deletePlaylist(id: number): Promise<void> {
  await prisma.playlist.delete({ where: { id } })
}

export async function setGenre(videoId: string, genre: string | null): Promise<void> {
  await prisma.track.updateMany({ where: { videoId }, data: { genre: genre?.trim() || null } })
}

export async function setPlaylistGenre(id: number, genre: string | null): Promise<void> {
  await prisma.playlist.update({ where: { id }, data: { genre: genre?.trim() || null } })
}

/** Genres present in the library, most tracks first. Untagged tracks are not a genre. */
export async function genres(): Promise<{ genre: string; count: number }[]> {
  const rows = await prisma.track.groupBy({
    by: ['genre'],
    where: { genre: { not: null } },
    _count: { genre: true },
    orderBy: { _count: { genre: 'desc' } }
  })
  return rows.map((r) => ({ genre: r.genre!, count: r._count.genre }))
}

export const tracksByGenre = async (genre: string, limit = 40): Promise<SavedTrack[]> =>
  (
    await prisma.track.findMany({
      where: { genre },
      orderBy: { addedAt: 'desc' },
      take: limit,
      select: SELECT
    })
  ).map(toSaved)

/**
 * "Made for you": library tracks weighted by how much the user likes their genre
 * and artist. Likes count double — an explicit like is a stronger signal than a
 * play, which might just be a track that came up in a queue.
 *
 * Deliberately excludes the tracks that built the profile (likes, top plays):
 * a recommendation row that lists your five favourite songs back at you is a
 * mirror, not a suggestion.
 *
 * ponytail: two weighted counters and a sort. No ML, no embeddings; the
 * library is a few thousand rows at most.
 */
export async function recommended(limit = 20): Promise<SavedTrack[]> {
  const [likes, plays] = await Promise.all([
    prisma.like.findMany({
      select: { track: { select: { id: true, artist: true, genre: true } } }
    }),
    prisma.historyEntry.groupBy({
      by: ['trackId'],
      _count: { trackId: true },
      orderBy: { _count: { trackId: 'desc' } },
      take: 100
    })
  ])

  const genreScore = new Map<string, number>()
  const artistScore = new Map<string, number>()
  const seed = new Set<number>()
  const bump = (m: Map<string, number>, k: string | null, n: number): void => {
    if (k) m.set(k, (m.get(k) ?? 0) + n)
  }

  for (const { track } of likes) {
    seed.add(track.id)
    bump(genreScore, track.genre, 2)
    bump(artistScore, track.artist, 2)
  }

  if (plays.length) {
    const played = await prisma.track.findMany({
      where: { id: { in: plays.map((p) => p.trackId) } },
      select: { id: true, artist: true, genre: true }
    })
    const count = new Map(plays.map((p) => [p.trackId, p._count.trackId]))
    for (const t of played) {
      // Log-damped: 40 plays of one song should not drown out the rest of the taste profile.
      const weight = Math.log2(1 + (count.get(t.id) ?? 1))
      bump(genreScore, t.genre, weight)
      bump(artistScore, t.artist, weight)
    }
    for (const t of played.slice(0, 10)) seed.add(t.id)
  }

  if (!genreScore.size && !artistScore.size) return []

  const pool = await prisma.track.findMany({
    where: {
      id: { notIn: [...seed] },
      OR: [{ genre: { in: [...genreScore.keys()] } }, { artist: { in: [...artistScore.keys()] } }]
    },
    orderBy: { addedAt: 'desc' },
    take: 500,
    select: { id: true, ...SELECT }
  })

  return pool
    .map((t) => ({
      t,
      score: (genreScore.get(t.genre ?? '') ?? 0) + (artistScore.get(t.artist ?? '') ?? 0)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => toSaved(s.t))
}
