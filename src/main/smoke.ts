import { app } from 'electron'
import { prisma } from './db'
import * as lib from './library'
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
    videoId: `smoke${n}`.padEnd(11, '0'),
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

  await lib.deletePlaylist(id)
  ok('delete removes the playlist', (await lib.playlists()).length === 0)
  ok('cascade cleared its rows', (await prisma.playlistTrack.count()) === 0)

  console.log(process.exitCode ? '\nSMOKE FAILED' : '\nSMOKE OK')
  app.exit(Number(process.exitCode ?? 0))
}
