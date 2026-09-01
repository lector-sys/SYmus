import { useEffect, useState } from 'react'
import { BarChart3, Mic2 } from 'lucide-react'
import type { Track } from '../../../preload'
import type { Charts as ChartsData } from '../../../preload/features/explore'
import { TrackCard } from '../TrackRow'
import { useNav } from '../store'
import { useLibrary } from '../useLibrary'
import { CardSkeletons, Chip, Empty, Eyebrow, Shelf } from '../ui'

/**
 * The one shelf here that is not counted locally.
 *
 * It appears only when there is too little listening to rank, and it is a
 * plain YouTube search — the same machinery as the New releases tab. Its title
 * says where it came from, because it sits directly beneath two shelves that
 * really are this library's own numbers.
 */
const POPULAR_QUERY = 'popular songs this month'

function PopularRow(): React.JSX.Element | null {
  const [tracks, setTracks] = useState<Track[] | null>(null)

  useEffect(() => {
    let stale = false
    window.api.explore
      .shelf(POPULAR_QUERY, null)
      .then((found) => {
        if (!stale) setTracks(found)
      })
      .catch(() => {
        if (!stale) setTracks([])
      })
    return () => {
      stale = true
    }
  }, [])

  if (tracks && !tracks.length) return null

  return (
    <section className="mb-9">
      <Eyebrow>Popular right now (from search)</Eyebrow>
      {!tracks ? (
        <CardSkeletons />
      ) : (
        <Shelf>
          {tracks.map((t, i) => (
            <TrackCard key={t.videoId} track={t} list={tracks} index={i} />
          ))}
        </Shelf>
      )}
    </section>
  )
}

/**
 * The Charts tab.
 *
 * Everything above the searched row is this library's own history: tracks and
 * artists ranked by how often they were actually played here. There is no
 * global chart in this app and no source for one, which is what the tab's
 * subtitle tells the user before they read a single row.
 */
export default function Charts(): React.JSX.Element {
  const go = useNav((s) => s.go)
  const { data, loading } = useLibrary<ChartsData | null>(
    () => window.api.explore.charts(),
    null,
    []
  )

  if (loading && !data) return <CardSkeletons />

  const tracks = data?.tracks ?? []
  const artists = data?.artists ?? []

  if (!tracks.length && !artists.length) {
    return (
      <Empty
        icon={BarChart3}
        title="Nothing played yet"
        hint="These lists are built from what you play here, so they fill in as you listen."
      />
    )
  }

  return (
    <>
      {tracks.length > 0 && (
        <section className="mb-9">
          <Eyebrow>Your top tracks</Eyebrow>
          <Shelf>
            {tracks.map((t, i) => (
              <TrackCard
                key={t.videoId}
                track={t}
                list={tracks}
                index={i}
                subtitle={`${t.plays} play${t.plays === 1 ? '' : 's'} · ${t.artist ?? 'Unknown artist'}`}
              />
            ))}
          </Shelf>
        </section>
      )}

      {artists.length > 0 && (
        <section className="mb-9">
          <Eyebrow>Your top artists</Eyebrow>
          <div className="flex flex-wrap gap-2">
            {artists.map((a) => (
              <Chip
                key={a.artist}
                icon={Mic2}
                label={a.artist}
                count={a.plays}
                onClick={() => go({ kind: 'artist', name: a.artist })}
              />
            ))}
          </div>
        </section>
      )}

      {data?.sparse && (
        <>
          <p className="mb-6 text-xs text-ash">
            There is not much listening here yet, so the ranking above is thin. The row below is a
            YouTube search, not part of your counts.
          </p>
          <PopularRow />
        </>
      )}
    </>
  )
}
