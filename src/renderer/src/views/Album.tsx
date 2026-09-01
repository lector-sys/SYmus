import { Disc3, Play, Radio, Shuffle } from 'lucide-react'
import type { AlbumTrack } from '../../../preload/features/albums'
import { usePlayer, useNav } from '../store'
import { useLibrary } from '../useLibrary'
import TrackRow from '../TrackRow'
import { Artwork, Empty, PageTitle, RowSkeletons } from '../ui'

const pill =
  'flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-line px-5 py-2.5 text-[13px] font-medium transition-colors hover:border-dust hover:bg-panel disabled:opacity-25'

/**
 * One album's tracklist.
 *
 * Ordered by when tracks entered the library, which is the closest thing to the
 * album's running order available — YouTube gives a track number in its metadata
 * but there is no column to store it, so real running order needs a migration.
 */
export default function Album({
  name,
  artist
}: {
  name: string
  artist: string | null
}): React.JSX.Element {
  const { playNow, toggleShuffle, shuffle, startRadio } = usePlayer()
  const go = useNav((s) => s.go)

  const { data: tracks, loading } = useLibrary(
    () => window.api.albums.tracks(name, artist),
    [] as AlbumTrack[],
    [name, artist ?? '']
  )

  if (loading) {
    return (
      <div className="view-enter px-6 py-6">
        <RowSkeletons />
      </div>
    )
  }

  return (
    <div className="view-enter px-6 py-6">
      <div className="mb-6 flex flex-wrap items-end gap-x-5 gap-y-3">
        {/* Artwork size="lg" is h-full/w-full — sized by its parent, which is a
            constrained Card everywhere else. In a free-standing header it has to
            be boxed or it swallows the page. */}
        <div className="h-28 w-28 shrink-0">
          <Artwork src={tracks[0]?.thumbnailUrl} size="lg" rounded="rounded-xl" />
        </div>
        <div className="min-w-64 flex-1">
          <PageTitle sub={`${tracks.length} track${tracks.length === 1 ? '' : 's'}`}>
            {name}
          </PageTitle>
          {artist && (
            <button
              onClick={() => go({ kind: 'artist', name: artist })}
              className="mt-1 text-[13px] text-ash transition-colors hover:text-ember"
            >
              {artist}
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => playNow(tracks)}
            disabled={!tracks.length}
            className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-ember px-5 py-2.5 text-[13px] font-semibold text-ink transition-transform duration-150 ease-[cubic-bezier(.22,1,.36,1)] hover:scale-[1.03] active:scale-95 disabled:scale-100 disabled:opacity-25"
          >
            <Play size={15} fill="currentColor" /> Play
          </button>
          <button
            onClick={() => {
              if (!shuffle) toggleShuffle()
              playNow(tracks)
            }}
            disabled={!tracks.length}
            className={pill}
          >
            <Shuffle size={15} /> Shuffle
          </button>
          <button
            onClick={() => tracks[0] && startRadio(tracks[0], name)}
            disabled={!tracks.length}
            className={pill}
          >
            <Radio size={15} /> Start radio
          </button>
        </div>
      </div>

      {tracks.length ? (
        tracks.map((t, i) => (
          <TrackRow key={t.videoId} track={t} list={tracks} index={i} showGenre />
        ))
      ) : (
        <Empty
          icon={Disc3}
          title={`Nothing on ${name}`}
          hint="Album names come from YouTube's auto-generated music uploads. Use Find album info on the artist page to look them up."
        />
      )}
    </div>
  )
}
