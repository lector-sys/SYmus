import { useState } from 'react'
import { Disc3, Loader2, Play, Plus, Radio, Search, Shuffle, Tag } from 'lucide-react'
import type { Track } from '../../../preload'
import type { AlbumTrack } from '../../../preload/features/albums'
import { usePlayer, useNav } from '../store'
import { useLibrary } from '../useLibrary'
import TrackRow from '../TrackRow'
import { Artwork, Card, Empty, Eyebrow, PageTitle, RowSkeletons, Shelf } from '../ui'

const pill =
  'flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-line px-4 py-2 text-[13px] font-medium transition-colors hover:border-dust hover:bg-panel disabled:opacity-25'

/**
 * Everything the library knows about one artist.
 *
 * Built around tracks rather than albums: YouTube only exposes album names on
 * its auto-generated music uploads, so most rows have none. Albums appear as a
 * shelf when the data exists, and the page still works when it does not.
 */
export default function ArtistPage({ name }: { name: string }): React.JSX.Element {
  const { playNow, toggleShuffle, shuffle, startRadio, toast, libraryChanged } = usePlayer()
  const go = useNav((s) => s.go)
  const [enriching, setEnriching] = useState<{ done: number; total: number } | null>(null)
  const [found, setFound] = useState<Track[] | null>(null)
  const [searching, setSearching] = useState(false)

  const { data, loading } = useLibrary(
    () => window.api.albums.artist(name),
    { albums: [], tracks: [] as AlbumTrack[], untagged: 0 },
    [name]
  )

  const tracks = data.tracks

  async function enrich(): Promise<void> {
    setEnriching({ done: 0, total: data.untagged })
    try {
      const res = await window.api.albums.enrich(name, setEnriching)
      toast(
        res.updated
          ? `Found album names for ${res.updated} of ${res.checked} tracks`
          : `No album data published for these ${res.checked} tracks`
      )
      libraryChanged()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err))
    } finally {
      setEnriching(null)
    }
  }

  async function findMore(): Promise<void> {
    setSearching(true)
    try {
      setFound(await window.api.albums.findMore(name))
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err))
    } finally {
      setSearching(false)
    }
  }

  async function addFound(): Promise<void> {
    if (!found?.length) return
    try {
      const n = await window.api.albums.add(found, name)
      toast(`Added ${n} tracks by ${name}`)
      setFound(null)
      libraryChanged()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err))
    }
  }

  if (loading) {
    return (
      <div className="view-enter px-6 py-6">
        <RowSkeletons />
      </div>
    )
  }

  return (
    <div className="view-enter px-6 py-6">
      {/* Wraps because the content pane is ~620px with the queue open: artwork,
          a long artist name and three actions do not fit on one line. */}
      <div className="mb-6 flex flex-wrap items-end gap-x-5 gap-y-3">
        {/* Artwork size="lg" is h-full/w-full — sized by its parent, which is a
            constrained Card everywhere else. In a free-standing header it has to
            be boxed or it swallows the page. */}
        <div className="h-28 w-28 shrink-0">
          <Artwork src={tracks[0]?.thumbnailUrl} size="lg" rounded="rounded-xl" />
        </div>
        <div className="min-w-64 flex-1">
          <PageTitle
            sub={`${tracks.length} track${tracks.length === 1 ? '' : 's'}${
              data.albums.length
                ? ` · ${data.albums.length} album${data.albums.length === 1 ? '' : 's'}`
                : ''
            }`}
          >
            {name}
          </PageTitle>
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
            <Shuffle size={15} /> Shuffle all
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

      {data.albums.length > 0 && (
        <section className="mb-8">
          <Eyebrow>Albums</Eyebrow>
          <Shelf>
            {data.albums.map((a) => (
              <Card
                key={a.name}
                art={a.coverUrl}
                title={a.name}
                subtitle={`${a.count} track${a.count === 1 ? '' : 's'}`}
                onOpen={() => go({ kind: 'album', name: a.name, artist: name })}
                onPlay={() =>
                  window.api.albums
                    .tracks(a.name, name)
                    .then((t) => t.length && playNow(t))
                    .catch(() => {})
                }
              />
            ))}
          </Shelf>
        </section>
      )}

      <Eyebrow
        action={
          <div className="flex gap-2">
            {data.untagged > 0 && (
              <button
                onClick={enrich}
                disabled={Boolean(enriching)}
                className="flex items-center gap-1.5 rounded-full border border-line px-3.5 py-1 text-[11px] font-medium transition-colors hover:border-dust disabled:opacity-40"
              >
                {enriching ? (
                  <>
                    <Loader2 size={11} className="animate-spin text-ember" />
                    {enriching.done}/{enriching.total}
                  </>
                ) : (
                  <>
                    <Disc3 size={11} /> Find album info
                  </>
                )}
              </button>
            )}
            <button
              onClick={findMore}
              disabled={searching}
              className="flex items-center gap-1.5 rounded-full border border-line px-3.5 py-1 text-[11px] font-medium transition-colors hover:border-dust disabled:opacity-40"
            >
              {searching ? (
                <Loader2 size={11} className="animate-spin text-ember" />
              ) : (
                <Search size={11} />
              )}
              Find more
            </button>
          </div>
        }
      >
        Tracks
      </Eyebrow>

      {tracks.length ? (
        tracks.map((t, i) => (
          <TrackRow key={t.videoId} track={t} list={tracks} index={i} showGenre />
        ))
      ) : (
        <Empty
          icon={Tag}
          title={`Nothing by ${name}`}
          hint="Use Find more to pull their tracks in from YouTube."
        />
      )}

      {found && (
        <section className="mt-8">
          <Eyebrow
            action={
              found.length > 0 ? (
                <button
                  onClick={addFound}
                  className="flex items-center gap-1.5 rounded-full bg-lifted px-3.5 py-1 text-[11px] font-medium transition-colors hover:bg-line"
                >
                  <Plus size={11} /> Add all {found.length}
                </button>
              ) : undefined
            }
          >
            From YouTube
          </Eyebrow>
          {found.length ? (
            found.map((t, i) => <TrackRow key={t.videoId} track={t} list={found} index={i} />)
          ) : (
            <Empty
              icon={Search}
              title="Nothing new found"
              hint={`Everything YouTube returned for ${name} is already in your library.`}
            />
          )}
        </section>
      )}
    </div>
  )
}
