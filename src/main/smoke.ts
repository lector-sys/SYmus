import { app } from 'electron'
import { prisma } from './db'
import * as lib from './library'
import * as imp from './import'
import type { Track } from './youtube'

/**
 * `npm run smoke` — exercises every library path against a real SQLite file with
 * the real migrations applied, then exits. The Prisma calls are only meaningfully
 * testable against a real database, and this is cheaper than mocking one.
 *
 * Runs on a throwaway userData dir (see the script), so it never touches the
 * user's library.
 */
export async function smoke(): Promise<void> {
  const track = (n: number, title: string, artist: string): Track => ({
    // Zero-padded before the fill, or `smoke1` and `smoke10` both pad to
    // `smoke100000` and two different fixtures silently become the same row.
    videoId: `s${String(n).padStart(3, '0')}`.padEnd(11, '0'),
    title,
    artist,
    thumbnailUrl: `https://i.ytimg.com/vi/smoke${n}/hqdefault.jpg`,
    duration: 180 + n
  })

  const ok = (label: string, cond: boolean, detail?: unknown): void => {
    console.log(
      `${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : `  -> ${JSON.stringify(detail)}`}`
    )
    if (!cond) process.exitCode = 1
  }

  // -- genre inference -----------------------------------------------------
  ok('infers from title', lib.inferGenre('Best Jazz Standards') === 'Jazz')
  ok('specific beats general', lib.inferGenre('lofi hip hop radio') === 'Lo-fi')
  ok('no match is null', lib.inferGenre('asdfghjkl') === null)
  ok('empty is null', lib.inferGenre(null, undefined, '  ') === null)

  // -- save + genre tagging ------------------------------------------------
  const jazz = track(1, 'Blue in Green', 'Miles Davis')
  const rock = track(2, 'Punk Rock Anthem', 'Nirvana')
  const plain = track(3, 'Untitled Recording', 'Someone')
  await lib.saveTracks([jazz, rock, plain], 'jazz essentials')

  const saved = await prisma.track.findMany({ select: { videoId: true, genre: true } })
  const genreOf = new Map(saved.map((t) => [t.videoId, t.genre]))
  ok('genre from hint', genreOf.get(plain.videoId) === 'Jazz', [...genreOf])
  ok('own title beats the hint', genreOf.get(rock.videoId) === 'Rock', [...genreOf])
  ok('save is idempotent', (await prisma.track.count()) === 3)

  // A manual tag must survive a re-save.
  await lib.setGenre(rock.videoId, 'Grunge')
  await lib.saveTracks([rock], 'jazz essentials')
  const reSaved = await prisma.track.findUnique({ where: { videoId: rock.videoId } })
  ok('manual genre is not overwritten', reSaved?.genre === 'Grunge', reSaved?.genre)

  // -- likes ---------------------------------------------------------------
  await lib.setLiked(jazz, true)
  ok('like recorded', (await lib.likedTracks()).length === 1)
  await lib.setLiked(jazz, true)
  ok('like is idempotent', (await lib.likedTracks()).length === 1)
  await lib.setLiked(jazz, false)
  ok('unlike removes', (await lib.likedTracks()).length === 0)
  await lib.setLiked(jazz, true)

  // -- history -------------------------------------------------------------
  for (let i = 0; i < 3; i++) await lib.recordPlay(rock)
  await lib.recordPlay(jazz)
  const recent = await lib.recentlyPlayed()
  ok(
    'recent is deduped, newest first',
    recent.length === 2 && recent[0].videoId === jazz.videoId,
    recent.map((t) => t.videoId)
  )
  const top = await lib.mostPlayed()
  ok('most played ranks by count', top[0]?.videoId === rock.videoId && top[0].plays === 3, top)

  // A track played but never searched still enters the library.
  const fresh = track(4, 'Never Saved Before', 'Nobody')
  await lib.recordPlay(fresh)
  ok('play saves the track', (await prisma.track.count()) === 4)

  // -- playlists -----------------------------------------------------------
  const id = await lib.createPlaylist('Late Night Jazz', [jazz, rock])
  ok('playlist genre inferred from title', (await lib.playlists())[0]?.genre === 'Jazz')
  ok('playlist has both tracks', (await lib.playlistTracks(id)).length === 2)
  ok(
    'playlist order is insertion order',
    (await lib.playlistTracks(id))[0].videoId === jazz.videoId
  )
  ok('cover taken from first track', (await lib.playlists())[0]?.coverUrl === jazz.thumbnailUrl)

  ok('re-adding an existing track adds nothing', (await lib.addToPlaylist(id, [jazz])) === 0)
  ok('adding a new track appends', (await lib.addToPlaylist(id, [plain])) === 1)
  const order = await lib.playlistTracks(id)
  ok(
    'append lands at the end',
    order[2]?.videoId === plain.videoId,
    order.map((t) => t.videoId)
  )

  await lib.removeFromPlaylist(id, jazz.videoId)
  ok('remove drops one track', (await lib.playlistTracks(id)).length === 2)
  await lib.renamePlaylist(id, 'Renamed')
  ok('rename sticks', (await lib.playlists())[0]?.title === 'Renamed')
  ok('count reported', (await lib.playlists())[0]?.count === 2)

  // -- genres --------------------------------------------------------------
  const g = await lib.genres()
  ok(
    'genres exclude untagged',
    g.every((x) => Boolean(x.genre)),
    g
  )
  ok(
    'byGenre filters',
    (await lib.tracksByGenre('Jazz')).every((t) => t.genre === 'Jazz')
  )

  // -- recommendations -----------------------------------------------------
  // Profile: likes Jazz/Miles Davis, plays Grunge/Nirvana. A Jazz track that is
  // neither liked nor played is the thing a recommendation row should surface.
  const candidate = track(5, 'Jazz After Hours', 'Bill Evans')
  await lib.saveTracks([candidate], 'jazz')
  const recs = await lib.recommended()
  ok(
    'recommends an unheard track in a liked genre',
    recs.some((t) => t.videoId === candidate.videoId),
    recs.map((t) => t.title)
  )
  ok('does not recommend what you already liked', !recs.some((t) => t.videoId === jazz.videoId))

  // -- genre inference against REAL-WORLD text ------------------------------
  // The earlier cases all fed titles that contain a genre word. Real titles read
  // "Artist - Song (Official Video)" and real searches read "blinding lights",
  // which is why the library ended up 92% untagged in practice. These cases pin
  // the false positives that shipped, so they cannot come back.
  ok(
    'band name is not a genre',
    lib.inferGenre('The Weeknd - I Feel It Coming ft. Daft Punk') === null
  )
  // Soundtrack is right here — it is a theme song. The bug was Electronic,
  // matched on the bare word "house".
  ok(
    '"Full House" is not Electronic',
    lib.inferGenre('Full House Theme Song') !== 'Electronic',
    lib.inferGenre('Full House Theme Song')
  )
  ok('"Hey Soul Sister" is not R&B', lib.inferGenre('Train - Hey Soul Sister') === null)
  ok('"Heart and Soul" is not R&B', lib.inferGenre('Heart and Soul - Piano Duet') === null)
  ok('real genre words still match', lib.inferGenre('Best punk rock anthems') === 'Rock')
  ok('house music still matches', lib.inferGenre('deep house mix 2024') === 'Electronic')
  ok('soul music still matches', lib.inferGenre('northern soul classics') === 'R&B')

  // -- tagging one track tags the artist's other untagged tracks -------------
  const weeknd = [
    track(10, 'The Weeknd - Blinding Lights (Official Video)', 'The Weeknd'),
    track(11, 'The Weeknd - Save Your Tears', 'The Weeknd'),
    track(12, 'The Weeknd - Out of Time', 'The Weeknd')
  ]
  await lib.saveTracks(weeknd, 'blinding lights')
  ok(
    'realistic titles infer nothing on their own',
    (await prisma.track.findMany({ where: { artist: 'The Weeknd' } })).every((t) => !t.genre)
  )

  const alsoTagged = await lib.setGenre(weeknd[0].videoId, 'R&B')
  ok('propagates to the other tracks by that artist', alsoTagged === 2, alsoTagged)
  ok(
    'every Weeknd track is now tagged',
    (await prisma.track.findMany({ where: { artist: 'The Weeknd' } })).every(
      (t) => t.genre === 'R&B'
    )
  )

  // A hand-set tag on a sibling must survive a later propagation.
  await lib.setGenre(weeknd[2].videoId, 'Pop')
  const spread = await lib.setGenre(weeknd[1].videoId, 'Soundtrack')
  ok('propagation never overwrites an existing tag', spread === 0, spread)
  ok(
    'the hand-set tag is intact',
    (await prisma.track.findUnique({ where: { videoId: weeknd[2].videoId } }))?.genre === 'Pop'
  )

  // -- coverage + artist fallback -------------------------------------------
  const cov = await lib.genreCoverage()
  ok('coverage reports tagged and total', cov.total > 0 && cov.tagged > 0, cov)
  const artists = await lib.topArtists()
  ok(
    'top artists ranks by track count',
    artists[0]?.artist === 'The Weeknd',
    JSON.stringify(artists.slice(0, 3))
  )
  ok('byArtist returns that artist only', (await lib.tracksByArtist('The Weeknd')).length === 3)

  // -- autoplay / radio scoring ---------------------------------------------
  // Weeknd tracks are R&B by now; add an unrelated genre so the ranking has
  // something wrong to prefer if the scoring is broken.
  const metal = track(20, 'Thrash Attack', 'Some Band')
  await lib.saveTracks([metal], 'metal')

  // A same-genre track by a DIFFERENT artist. The sibling Weeknd tracks were
  // retagged Soundtrack/Pop above, so this is the only genre match — which makes
  // it the clean test of "genre outranks artist".
  const sameGenre = track(21, 'Nightcall', 'Another Artist')
  await lib.saveTracks([sameGenre])
  await lib.setGenre(sameGenre.videoId, 'R&B')

  const seed = weeknd[0]
  const similar = await lib.similarTo(seed, [], 5)
  ok('similar excludes the seed itself', !similar.some((t) => t.videoId === seed.videoId))
  ok(
    'genre match outranks artist match',
    similar[0]?.videoId === sameGenre.videoId,
    JSON.stringify(similar.slice(0, 3).map((t) => [t.title, t.genre, t.artist]))
  )
  ok(
    'same-artist tracks still make the list',
    similar.some((t) => t.artist === 'The Weeknd'),
    JSON.stringify(similar.map((t) => t.artist))
  )
  ok(
    'similar honours the exclusion list',
    !(await lib.similarTo(seed, [weeknd[1].videoId, weeknd[2].videoId], 5)).some((t) =>
      [weeknd[1].videoId, weeknd[2].videoId].includes(t.videoId)
    )
  )
  ok('similar respects the limit', (await lib.similarTo(seed, [], 2)).length <= 2)

  // -- playlist import: source detection ------------------------------------
  ok(
    'detects YouTube',
    imp.detectSource('https://www.youtube.com/playlist?list=PLabc') === 'youtube'
  )
  ok('detects Spotify', imp.detectSource('https://open.spotify.com/playlist/37i9dQ') === 'spotify')
  ok(
    'detects Apple Music',
    imp.detectSource('https://music.apple.com/us/playlist/hits/pl.abc123') === 'apple'
  )
  ok('rejects an unrelated host', imp.detectSource('https://example.com/playlist/1') === null)
  ok('rejects free text', imp.detectSource('not a url') === null)
  // A lookalike host must not be taken for the real one.
  ok(
    'rejects a lookalike host',
    imp.detectSource('https://spotify.com.evil.tld/playlist/1') === null
  )

  ok(
    'reads a Spotify id from a link',
    imp.spotifyPlaylistId('https://open.spotify.com/playlist/37i9dQZF1DX?si=x') === '37i9dQZF1DX'
  )
  ok(
    'reads a Spotify id from a URI',
    imp.spotifyPlaylistId('spotify:playlist:37i9dQZF1DX') === '37i9dQZF1DX'
  )
  const appleRef = imp.applePlaylistRef(
    'https://music.apple.com/gb/playlist/todays-hits/pl.f4d106f'
  )
  ok(
    'reads an Apple storefront and id',
    appleRef?.storefront === 'gb' && appleRef?.id === 'pl.f4d106f',
    JSON.stringify(appleRef)
  )

  // Sources with no keys must report themselves unconfigured rather than throw.
  ok('YouTube needs no credentials', imp.configured('youtube') === true)
  const hadSpotify = process.env.SPOTIFY_CLIENT_ID
  delete process.env.SPOTIFY_CLIENT_ID
  ok('Spotify without keys is unconfigured', imp.configured('spotify') === false)
  if (hadSpotify) process.env.SPOTIFY_CLIENT_ID = hadSpotify

  // -- playlist import: match confidence ------------------------------------
  // A YouTube search always returns something, so without this check an import
  // silently fills the playlist with reactions and interviews.
  const want = { title: 'Blinding Lights', artist: 'The Weeknd', album: 'After Hours' }
  const yt = (
    title: string,
    artist: string
  ): imp.ForeignTrack extends never ? never : Parameters<typeof imp.isConfidentMatch>[1] => ({
    videoId: 'x'.repeat(11),
    title,
    artist,
    thumbnailUrl: '',
    duration: 200
  })
  ok(
    'accepts the real track',
    imp.isConfidentMatch(want, yt('The Weeknd - Blinding Lights (Official Video)', 'The Weeknd'))
  )
  ok(
    'accepts it when the artist is only in the channel',
    imp.isConfidentMatch(want, yt('Blinding Lights', 'TheWeekndVEVO'))
  )
  ok(
    'rejects a reaction video',
    !imp.isConfidentMatch(want, yt('Blinding Lights REACTION', 'Some Channel'))
  )
  ok(
    'rejects a different song by the same artist',
    !imp.isConfidentMatch(want, yt('The Weeknd - Save Your Tears', 'The Weeknd'))
  )
  ok(
    'rejects the right title by the wrong artist',
    !imp.isConfidentMatch(want, yt('Blinding Lights', 'Random Cover Guy'))
  )
  ok(
    'rejects karaoke',
    !imp.isConfidentMatch(want, yt('Blinding Lights (Karaoke Version)', 'The Weeknd'))
  )
  ok(
    'rejects a bracketed instrumental',
    !imp.isConfidentMatch(want, yt('Blinding Lights [Instrumental]', 'The Weeknd'))
  )
  ok(
    'rejects a sped-up edit',
    !imp.isConfidentMatch(want, yt('Blinding Lights (sped up)', 'The Weeknd'))
  )

  await lib.deletePlaylist(id)
  ok('delete removes the playlist', (await lib.playlists()).length === 0)
  ok('cascade cleared its rows', (await prisma.playlistTrack.count()) === 0)

  console.log(process.exitCode ? '\nSMOKE FAILED' : '\nSMOKE OK')
  app.exit(Number(process.exitCode ?? 0))
}
