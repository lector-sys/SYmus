import { useEffect, useState } from 'react'
import { Heart, House, Library, ListMusic, Search, SearchX } from 'lucide-react'
import type { Track } from '../../preload'
import { usePlayer, useNav, type View } from './store'
import { useLibrary } from './useLibrary'
import PlayerBar from './PlayerBar'
import Queue from './Queue'
import TrackRow from './TrackRow'
import Home from './Home'
import { LibraryView, LikedView, PlaylistView, GenreView } from './Library'
import { Empty, Eyebrow, PageTitle, RowSkeletons } from './ui'

function SearchView(): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Track[]>([])
  const [busy, setBusy] = useState(false)
  const [ran, setRan] = useState('')
  const { playNow, addToQueue, toast, libraryChanged } = usePlayer()

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    const q = query.trim()
    if (!q) return
    setBusy(true)
    try {
      // A pasted link resolves to its own tracks (the whole playlist unless it
      // is an RD… mix); anything else is a search.
      let tracks: Track[]
      let name: string | null = null
      if (/^https?:\/\//i.test(q)) {
        ;({ name, tracks } = await window.api.resolveUrl(q))
        if (name) toast(`Loaded ${name} — ${tracks.length} tracks`)
      } else {
        tracks = await window.api.search(q)
      }
      setResults(tracks)
      setRan(q)
      // Saved with the query as a genre hint, so the library knows what these
      // are even if the user never plays them.
      window.api.lib
        .save(tracks, name ?? q)
        .then(libraryChanged)
        .catch(() => {})
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err))
      setResults([])
      setRan(q)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="view-enter px-6 py-6">
      <div className="mb-6">
        <PageTitle sub="Songs, albums, or any YouTube video and playlist link">Search</PageTitle>
      </div>

      <form onSubmit={submit} className="mb-8 flex gap-2">
        <div className="relative flex-1">
          <Search
            size={16}
            className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-dust"
          />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="What do you want to listen to?"
            className="w-full rounded-full border border-line bg-panel py-3 pr-4 pl-11 text-sm outline-none transition-colors placeholder:text-dust focus:border-dust"
          />
        </div>
        <button
          type="submit"
          disabled={busy || !query.trim()}
          className="rounded-full bg-ember px-6 text-[13px] font-semibold text-ink transition-transform duration-150 ease-[cubic-bezier(.22,1,.36,1)] hover:scale-[1.03] active:scale-95 disabled:scale-100 disabled:opacity-25"
        >
          {busy ? 'Searching' : 'Search'}
        </button>
      </form>

      {busy && <RowSkeletons />}

      {!busy && results.length > 0 && (
        <>
          <Eyebrow
            action={
              <div className="flex gap-2">
                <button
                  onClick={() => playNow(results)}
                  className="rounded-full bg-lifted px-3.5 py-1 text-[11px] font-medium transition-colors hover:bg-line"
                >
                  Play all
                </button>
                <button
                  onClick={() => addToQueue(results)}
                  className="rounded-full border border-line px-3.5 py-1 text-[11px] font-medium transition-colors hover:border-dust"
                >
                  Queue all
                </button>
              </div>
            }
          >
            {results.length} results
          </Eyebrow>
          {results.map((t, i) => (
            <TrackRow key={t.videoId} track={t} list={results} index={i} />
          ))}
        </>
      )}

      {!busy && ran && !results.length && (
        <Empty
          icon={SearchX}
          title={`Nothing found for ${ran}`}
          hint="Try fewer words, or paste the YouTube link directly."
        />
      )}
    </div>
  )
}

function NavButton({
  to,
  icon: Icon,
  label
}: {
  to: View
  icon: typeof House
  label: string
}): React.JSX.Element {
  const { view, go } = useNav()
  const on = view.kind === to.kind
  return (
    <button
      onClick={() => go(to)}
      aria-current={on ? 'page' : undefined}
      className={`relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors duration-150 ${
        on ? 'bg-raised text-chalk' : 'text-ash hover:bg-panel hover:text-chalk'
      }`}
    >
      {on && (
        <span
          aria-hidden
          className="absolute top-2 bottom-2 left-0 w-[3px] rounded-full bg-ember"
        />
      )}
      <Icon size={17} />
      {label}
    </button>
  )
}

/** The three bars of the app icon, as the wordmark. */
function Wordmark(): React.JSX.Element {
  return (
    <div className="flex items-center gap-2.5 px-3 pt-1 pb-5">
      <span aria-hidden className="flex h-4 items-end gap-[3px]">
        <span className="h-2 w-[3px] rounded-full bg-gradient-to-b from-flare to-ember" />
        <span className="h-4 w-[3px] rounded-full bg-gradient-to-b from-flare to-ember" />
        <span className="h-3 w-[3px] rounded-full bg-gradient-to-b from-flare to-ember" />
      </span>
      <span className="text-[15px] font-bold tracking-[0.06em]">SYmuS</span>
    </div>
  )
}

export default function App(): React.JSX.Element {
  const [queueOpen, setQueueOpen] = useState(true)
  const { toasts, refreshLikes } = usePlayer()
  const { view, go } = useNav()
  const { data: playlists } = useLibrary(() => window.api.lib.playlists(), [])

  // The liked set drives the heart on every row, so it is loaded once at boot.
  useEffect(() => {
    refreshLikes().catch(() => {})
  }, [refreshLikes])

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-ink">
      <div className="flex min-h-0 flex-1">
        <nav className="flex w-56 shrink-0 flex-col border-r border-line bg-panel p-3">
          <Wordmark />
          <div className="space-y-0.5">
            <NavButton to={{ kind: 'home' }} icon={House} label="Home" />
            <NavButton to={{ kind: 'search' }} icon={Search} label="Search" />
            <NavButton to={{ kind: 'library' }} icon={Library} label="Library" />
            <NavButton to={{ kind: 'liked' }} icon={Heart} label="Liked Songs" />
          </div>

          <div className="mt-6 min-h-0 flex-1 overflow-y-auto">
            <div className="px-3">
              <Eyebrow>Playlists</Eyebrow>
            </div>
            {playlists.map((p) => {
              const on = view.kind === 'playlist' && view.id === p.id
              return (
                <button
                  key={p.id}
                  onClick={() => go({ kind: 'playlist', id: p.id, title: p.title })}
                  aria-current={on ? 'page' : undefined}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left text-[13px] transition-colors duration-150 ${
                    on ? 'bg-raised text-chalk' : 'text-ash hover:text-chalk'
                  }`}
                >
                  <ListMusic size={14} className="shrink-0" />
                  <span className="truncate">{p.title}</span>
                </button>
              )
            })}
            {!playlists.length && (
              <p className="px-3 text-xs leading-relaxed text-dust">
                Playlists you create show up here.
              </p>
            )}
          </div>
        </nav>

        <main className="min-w-0 flex-1 overflow-y-auto">
          {/* The key remounts the pane on every navigation, which is what
              restarts the enter animation and resets scroll. */}
          <div key={JSON.stringify(view)} className="min-h-full">
            {view.kind === 'home' && <Home />}
            {view.kind === 'search' && <SearchView />}
            {view.kind === 'library' && <LibraryView />}
            {view.kind === 'liked' && <LikedView />}
            {view.kind === 'playlist' && <PlaylistView id={view.id} title={view.title} />}
            {view.kind === 'genre' && <GenreView name={view.name} />}
          </div>
        </main>

        {queueOpen && <Queue />}
      </div>

      <PlayerBar onToggleQueue={() => setQueueOpen((v) => !v)} queueOpen={queueOpen} />

      <div className="pointer-events-none fixed bottom-24 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="view-enter rounded-lg border border-line bg-raised px-4 py-2.5 text-[13px] shadow-2xl shadow-ink/70"
          >
            {t.message}
          </div>
        ))}
      </div>
    </div>
  )
}
