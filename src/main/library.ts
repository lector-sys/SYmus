import { prisma } from './db'
import { search, type Track } from './youtube'

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
  // `punk` alone matched the band name in "ft. Daft Punk" and tagged The Weeknd
  // as Rock. Genre words that are also common in band and song names must carry
  // their qualifier.
  ['Rock', /\brock\b|punk rock|pop punk|grunge|alt(ernative)?[- ]rock|indie rock|guitar solo/i],
  ['Hip-hop', /\bhip[- ]?hop\b|\brap\b|\btrap\b|drill\b|freestyle/i],
  // Bare `soul` caught "Hey Soul Sister" and "Heart and Soul".
  ['R&B', /\br ?& ?b\b|rhythm and blues|neo[- ]soul|soul music|northern soul/i],
  // Bare `house` caught "Full House Theme Song".
  [
    'Electronic',
    /\bedm\b|house music|deep house|tech house|progressive house|techno|trance|dubstep|drum ?& ?bass|\bdnb\b|synthwave|electro\b/i
  ],
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

/**
 * Tags a track, and carries the tag across to that artist's other *untagged*
 * tracks.
 *
 * Real titles read "Artist - Song (Official Video)" and real searches read
 * "blinding lights", so neither contains a genre word and automatic inference
 * tags almost nothing. Propagating by artist is what makes manual tagging worth
 * the click: one tag on a Weeknd track classifies every Weeknd track already in
 * the library.
 *
 * Only nulls are filled, so a tag the user set by hand is never overwritten and
 * this can never silently reclassify a deliberate choice.
 *
 * Returns how many other tracks were tagged, so the UI can say so.
 */
export async function setGenre(videoId: string, genre: string | null): Promise<number> {
  const clean = genre?.trim() || null
  const track = await prisma.track.findUnique({ where: { videoId }, select: { artist: true } })
  await prisma.track.updateMany({ where: { videoId }, data: { genre: clean } })
  if (!clean || !track?.artist) return 0

  const { count } = await prisma.track.updateMany({
    where: { artist: track.artist, genre: null, videoId: { not: videoId } },
    data: { genre: clean }
  })
  return count
}

/** How much of the library carries a genre. Drives the Home fallback. */
export async function genreCoverage(): Promise<{ tagged: number; total: number }> {
  const [tagged, total] = await Promise.all([
    prisma.track.count({ where: { genre: { not: null } } }),
    prisma.track.count()
  ])
  return { tagged, total }
}

/**
 * Artists with the most tracks in the library. Genre data stays sparse until the
 * user tags something, but artist is always present, so Home can offer browsing
 * by artist while the genre map fills in.
 */
export async function topArtists(limit = 16): Promise<{ artist: string; count: number }[]> {
  const rows = await prisma.track.groupBy({
    by: ['artist'],
    where: { artist: { not: null } },
    _count: { artist: true },
    orderBy: { _count: { artist: 'desc' } },
    take: limit
  })
  return rows.map((r) => ({ artist: r.artist!, count: r._count.artist }))
}

export const tracksByArtist = async (artist: string, limit = 60): Promise<SavedTrack[]> =>
  (
    await prisma.track.findMany({
      where: { artist },
      orderBy: { addedAt: 'desc' },
      take: limit,
      select: SELECT
    })
  ).map(toSaved)

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
 * "Made for you": library tracks weighted by how much the user likes their
 * genre and artist, from the shared taste profile — likes, plays, skips and
 * dislikes all feed in.
 *
 * Excludes the tracks that built the profile: a recommendation row that lists
 * your five favourite songs back at you is a mirror, not a suggestion. Also
 * excludes anything scoring at or below zero, so a disliked genre cannot be
 * padded back in just because nothing better is left.
 *
 * ponytail: two weighted maps and a sort. No ML; the library is a few thousand
 * rows at most.
 */
export async function recommended(limit = 20): Promise<SavedTrack[]> {
  const { genre, artist, exclude, disliked } = await taste()
  if (!genre.size && !artist.size) return []

  const wanted = (m: Map<string, number>): string[] =>
    [...m.entries()].filter(([, n]) => n > 0).map(([k]) => k)

  const genreKeys = wanted(genre)
  const artistKeys = wanted(artist)
  if (!genreKeys.length && !artistKeys.length) return []

  const pool = await prisma.track.findMany({
    where: {
      id: { notIn: [...exclude, ...disliked] },
      OR: [
        ...(genreKeys.length ? [{ genre: { in: genreKeys } }] : []),
        ...(artistKeys.length ? [{ artist: { in: artistKeys } }] : [])
      ]
    },
    orderBy: { addedAt: 'desc' },
    take: 500,
    select: { id: true, ...SELECT }
  })

  return pool
    .map((t) => ({
      t,
      score: (genre.get(t.genre ?? '') ?? 0) + (artist.get(t.artist ?? '') ?? 0)
    }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => toSaved(s.t))
}

export async function similarTo(
  seed: Track,
  exclude: string[] = [],
  limit = 10
): Promise<SavedTrack[]> {
  const row = await prisma.track.findUnique({
    where: { videoId: seed.videoId },
    select: { genre: true }
  })
  const genre = row?.genre ?? inferGenre(seed.title, seed.artist)
  const skip = new Set([seed.videoId, ...exclude])

  const plays = new Map(
    (
      await prisma.historyEntry.groupBy({
        by: ['trackId'],
        _count: { trackId: true }
      })
    ).map((g) => [g.trackId, g._count.trackId])
  )

  // Disliked tracks are never served, however well they otherwise score.
  const profile = await taste()
  const dislikedIds = [...profile.disliked]

  const match: Array<{ genre?: string; artist?: string }> = []
  if (genre) match.push({ genre })
  if (seed.artist) match.push({ artist: seed.artist })

  let picked: SavedTrack[] = []
  if (match.length) {
    const pool = await prisma.track.findMany({
      where: { OR: match, videoId: { notIn: [...skip] }, id: { notIn: dislikedIds } },
      take: 300,
      select: { id: true, ...SELECT }
    })
    picked = pool
      .map((t) => ({
        t,
        // Genre is the stronger signal: the same artist twice in a row is a
        // rut, whereas the same genre is what "similar" actually means. The
        // taste profile then nudges by how the user feels about that genre and
        // artist overall, so a disliked genre sinks even when it matches.
        score:
          (genre && t.genre === genre ? 3 : 0) +
          (seed.artist && t.artist === seed.artist ? 2 : 0) +
          Math.log2(1 + (plays.get(t.id) ?? 0)) +
          Math.max(-3, (profile.genre.get(t.genre ?? '') ?? 0) * 0.4) +
          Math.max(-3, (profile.artist.get(t.artist ?? '') ?? 0) * 0.4)
      }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => toSaved(s.t))
  }

  // Top up from the general profile before reaching for the network.
  if (picked.length < limit) {
    for (const t of await recommended(limit * 2)) {
      if (picked.length >= limit) break
      if (skip.has(t.videoId) || picked.some((p) => p.videoId === t.videoId)) continue
      picked.push(t)
    }
  }
  if (picked.length >= limit) return picked.slice(0, limit)

  // Nothing local left that fits. Ask YouTube, seeded from the track.
  const queries = [
    seed.artist ? `${seed.artist} songs` : null,
    genre ? `${genre} music mix` : null,
    seed.title
  ].filter((q): q is string => Boolean(q))

  for (const query of queries) {
    if (picked.length >= limit) break
    let found: Track[] = []
    try {
      found = await search(query, 20)
    } catch {
      // Offline, rate limited, yt-dlp missing. Autoplay degrades to whatever
      // the library already had rather than surfacing an error mid-playback.
      break
    }
    if (!found.length) continue
    await saveTracks(found, genre ?? query)
    for (const t of found) {
      if (picked.length >= limit) break
      if (skip.has(t.videoId) || picked.some((p) => p.videoId === t.videoId)) continue
      picked.push({ ...t, genre: genre ?? null })
    }
  }
  return picked.slice(0, limit)
}

/**
 * Thumbs-down. Deliberately not "the absence of a like": an explicit "not for
 * me" is a signal, an unrated track is not, and only the former should push a
 * track's genre and artist down the ranking.
 *
 * Disliking also clears any like, since holding both is meaningless.
 */
export async function setDisliked(track: Track, disliked: boolean): Promise<boolean> {
  const trackId = await oneId(track)
  if (disliked) {
    await prisma.dislike.upsert({ where: { trackId }, create: { trackId }, update: {} })
    await prisma.like.deleteMany({ where: { trackId } })
  } else {
    await prisma.dislike.deleteMany({ where: { trackId } })
  }
  return disliked
}

export async function dislikedTracks(): Promise<SavedTrack[]> {
  const rows = await prisma.dislike.findMany({
    orderBy: { dislikedAt: 'desc' },
    select: { track: { select: SELECT } }
  })
  return rows.map((r) => toSaved(r.track))
}

/** Marks the most recent play of a track as skipped — a mild negative signal. */
export async function markSkipped(videoId: string): Promise<void> {
  const track = await prisma.track.findUnique({ where: { videoId }, select: { id: true } })
  if (!track) return
  const last = await prisma.historyEntry.findFirst({
    where: { trackId: track.id },
    orderBy: { playedAt: 'desc' },
    select: { id: true }
  })
  if (last) await prisma.historyEntry.update({ where: { id: last.id }, data: { skipped: true } })
}

/**
 * The user's taste as weights over genres and artists, from likes, plays,
 * skips and dislikes.
 *
 * Extracted so recommended() and similarTo() score from the same profile —
 * previously each built its own, and a dislike would have had to be taught to
 * both.
 */
export interface Taste {
  genre: Map<string, number>
  artist: Map<string, number>
  /** Track ids that formed the profile, or are explicitly unwanted. */
  exclude: Set<number>
  disliked: Set<number>
}

export async function taste(): Promise<Taste> {
  const [likes, dislikes, plays] = await Promise.all([
    prisma.like.findMany({
      select: { track: { select: { id: true, artist: true, genre: true } } }
    }),
    prisma.dislike.findMany({
      select: { track: { select: { id: true, artist: true, genre: true } } }
    }),
    prisma.historyEntry.groupBy({
      by: ['trackId', 'skipped'],
      _count: { trackId: true },
      orderBy: { _count: { trackId: 'desc' } },
      take: 300
    })
  ])

  const genre = new Map<string, number>()
  const artist = new Map<string, number>()
  const exclude = new Set<number>()
  const disliked = new Set<number>()
  const bump = (m: Map<string, number>, k: string | null, n: number): void => {
    if (k) m.set(k, (m.get(k) ?? 0) + n)
  }

  for (const { track } of likes) {
    exclude.add(track.id)
    bump(genre, track.genre, 2)
    bump(artist, track.artist, 2)
  }

  // A dislike outweighs a like: getting an unwanted track again is worse than
  // missing a wanted one, and the user had to go out of their way to say so.
  for (const { track } of dislikes) {
    exclude.add(track.id)
    disliked.add(track.id)
    bump(genre, track.genre, -3)
    bump(artist, track.artist, -3)
  }

  if (plays.length) {
    const ids = [...new Set(plays.map((p) => p.trackId))]
    const rows = await prisma.track.findMany({
      where: { id: { in: ids } },
      select: { id: true, artist: true, genre: true }
    })
    const byId = new Map(rows.map((r) => [r.id, r]))
    for (const p of plays) {
      const t = byId.get(p.trackId)
      if (!t) continue
      // Log-damped so 40 plays of one song cannot drown out the rest of the
      // profile. Skips count against, at half the weight of a completed play.
      const weight = Math.log2(1 + p._count.trackId) * (p.skipped ? -0.5 : 1)
      bump(genre, t.genre, weight)
      bump(artist, t.artist, weight)
    }
    for (const p of plays.slice(0, 10)) exclude.add(p.trackId)
  }

  return { genre, artist, exclude, disliked }
}
