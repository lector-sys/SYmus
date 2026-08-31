import { Compass, Heart, ListMusic, Search } from 'lucide-react'
import type { SavedTrack } from '../../preload'
import { usePlayer, useNav } from './store'
import { useLibrary } from './useLibrary'
import { Card, CardSkeletons, Empty, Eyebrow, Shelf } from './ui'

/** Local hour decides the greeting. Small touch, but it makes the app feel awake. */
function greeting(): string {
  const h = new Date().getHours()
  if (h < 5) return 'Still up'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

/**
 * A shelf of tracks. Clicking a card plays that track and queues the rest of the
 * row behind it, so a row behaves like a playlist rather than a set of one-offs.
 */
function TrackShelf({
  title,
  tracks,
  loading,
  subtitle
}: {
  title: string
  tracks: SavedTrack[]
  loading: boolean
  subtitle?: (t: SavedTrack) => string
}): React.JSX.Element | null {
  const { playNow, current } = usePlayer()

  // An empty row is worse than no row: it implies something is broken. Rows that
  // have nothing to say simply do not render.
  if (!loading && !tracks.length) return null

  return (
    <section className="mb-9">
      <Eyebrow>{title}</Eyebrow>
      {loading ? (
        <CardSkeletons />
      ) : (
        <Shelf>
          {tracks.map((t, i) => (
            <Card
              key={t.videoId}
              art={t.thumbnailUrl}
              title={t.title}
              subtitle={subtitle ? subtitle(t) : (t.artist ?? 'Unknown artist')}
              playing={current?.videoId === t.videoId}
              onOpen={() => playNow(tracks, i)}
              onPlay={() => playNow(tracks, i)}
            />
          ))}
        </Shelf>
      )}
    </section>
  )
}

export default function Home(): React.JSX.Element {
  const go = useNav((s) => s.go)
  const { playNow } = usePlayer()

  const recent = useLibrary(() => window.api.lib.recent(16), [])
  const made = useLibrary(() => window.api.lib.recommended(16), [])
  const top = useLibrary(() => window.api.lib.top(16), [])
  const lists = useLibrary(() => window.api.lib.playlists(), [])
  const liked = useLibrary(() => window.api.lib.likes(), [])
  const genres = useLibrary(() => window.api.lib.genres(), [])

  const loading = recent.loading && made.loading && top.loading && lists.loading
  const empty =
    !loading && !recent.data.length && !top.data.length && !lists.data.length && !liked.data.length

  return (
    <div className="view-enter px-6 py-6">
      <h1 className="mb-1 text-[28px] font-bold tracking-[-0.02em]">{greeting()}</h1>
      <p className="mb-8 font-mono text-xs text-ash">
        {empty ? 'Your library is empty' : 'Picking up where you left off'}
      </p>

      {empty ? (
        <Empty
          icon={Search}
          title="Nothing to play yet"
          hint="Search for a song or paste a YouTube link. Everything you play, like, or save shows up on this page."
        />
      ) : (
        <>
          {/* Two permanent entry points, above the data-driven rows: Liked Songs
              always exists, and it is the one shelf that is never empty by accident. */}
          <section className="mb-9 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              onClick={() => go({ kind: 'liked' })}
              className="group flex items-center gap-4 overflow-hidden rounded-xl bg-panel p-3 text-left transition-colors duration-200 hover:bg-raised"
            >
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-flare via-ember to-[#c0392b]">
                <Heart size={24} className="text-ink" fill="currentColor" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold">Liked Songs</p>
                <p className="mt-0.5 font-mono text-xs text-ash">
                  {liked.loading ? '—' : `${liked.data.length} tracks`}
                </p>
              </div>
            </button>

            <button
              onClick={() => go({ kind: 'library' })}
              className="group flex items-center gap-4 overflow-hidden rounded-xl bg-panel p-3 text-left transition-colors duration-200 hover:bg-raised"
            >
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-lifted">
                <ListMusic size={22} className="text-ash" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold">Your Library</p>
                <p className="mt-0.5 font-mono text-xs text-ash">
                  {lists.loading ? '—' : `${lists.data.length} playlists`}
                </p>
              </div>
            </button>
          </section>

          <TrackShelf title="Recently played" tracks={recent.data} loading={recent.loading} />

          <TrackShelf
            title="Made for you"
            tracks={made.data}
            loading={made.loading}
            subtitle={(t) => t.genre ?? t.artist ?? 'Unknown artist'}
          />

          {(lists.loading || lists.data.length > 0) && (
            <section className="mb-9">
              <Eyebrow>Your playlists</Eyebrow>
              {lists.loading ? (
                <CardSkeletons count={4} />
              ) : (
                <Shelf>
                  {lists.data.map((p) => (
                    <Card
                      key={p.id}
                      art={p.coverUrl}
                      title={p.title}
                      subtitle={`${p.count} tracks${p.genre ? ` · ${p.genre}` : ''}`}
                      onOpen={() => go({ kind: 'playlist', id: p.id, title: p.title })}
                      onPlay={() =>
                        window.api.lib.playlistTracks(p.id).then((t) => t.length && playNow(t))
                      }
                    />
                  ))}
                </Shelf>
              )}
            </section>
          )}

          <TrackShelf
            title="Most listened"
            tracks={top.data}
            loading={top.loading}
            subtitle={(t) => {
              const plays = (t as SavedTrack & { plays?: number }).plays ?? 0
              return `${plays} play${plays === 1 ? '' : 's'}`
            }}
          />

          {genres.data.length > 0 && (
            <section className="mb-9">
              <Eyebrow>Browse by genre</Eyebrow>
              <div className="flex flex-wrap gap-2">
                {genres.data.map((g) => (
                  <button
                    key={g.genre}
                    onClick={() => go({ kind: 'genre', name: g.genre })}
                    className="group flex items-center gap-2.5 rounded-full border border-line bg-panel py-2 pr-3 pl-4 text-[13px] transition-colors duration-150 hover:border-dust hover:bg-raised"
                  >
                    <Compass
                      size={13}
                      className="text-dust transition-colors group-hover:text-ember"
                    />
                    {g.genre}
                    <span className="rounded-full bg-lifted px-2 py-0.5 font-mono text-[11px] text-ash">
                      {g.count}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
