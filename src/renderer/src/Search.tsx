import { useCallback, useEffect, useRef, useState } from 'react'
import { Clock, ListMusic, Search, SearchX, Trash2, User } from 'lucide-react'
import type { Track } from '../../preload'
import type { Discovery } from '../../preload/features/searchHistory'
import { usePlayer, useNav } from './store'
import TrackRow from './TrackRow'
import { Artwork, Empty, Eyebrow, PageTitle, RowSkeletons } from './ui'
import { forTab, type Tab } from './search/classify'

// Albums is deliberately absent. YouTube search exposes no album result type,
// and Track.album is not populated yet, so an Albums tab would be permanently
// empty. See the report: add it once albums land.
const TABS: { id: Tab; label: string }[] = [
  { id: 'songs', label: 'Songs' },
  { id: 'videos', label: 'Videos' },
  { id: 'playlists', label: 'Playlists' },
  { id: 'artists', label: 'Artists' }
]

export default function SearchView({ initial }: { initial?: string }): React.JSX.Element {
  const [query, setQuery] = useState(initial ?? '')
  const [results, setResults] = useState<Track[]>([])
  const [busy, setBusy] = useState(false)
  const [ran, setRan] = useState('')
  const [tab, setTab] = useState<Tab>('songs')

  const [suggestions, setSuggestions] = useState<string[]>([])
  const [recent, setRecent] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)

  // Playlists and artists each cost their own yt-dlp run, so they are fetched
  // when their tab is first opened and kept per query.
  const [discovery, setDiscovery] = useState<Record<string, Discovery[]>>({})
  const [discoveryBusy, setDiscoveryBusy] = useState(false)

  const { playNow, addToQueue, toast, libraryChanged } = usePlayer()
  const go = useNav((s) => s.go)
  const form = useRef<HTMLFormElement>(null)
  const box = useRef<HTMLDivElement>(null)

  const loadRecent = useCallback(() => {
    window.api.searchHistory
      .recent(8)
      .then(setRecent)
      .catch(() => setRecent([]))
  }, [])

  useEffect(() => loadRecent(), [loadRecent])

  // Debounced autocomplete. 180ms is below the point a suggestion list feels
  // laggy and well above the rate a fast typist produces characters.
  useEffect(() => {
    const q = query.trim()
    if (!q || q === ran) {
      // Clearing the box empties the list so the recent-searches panel can take
      // over. A one-shot reset, not derived state feeding back into a render.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSuggestions([])
      return
    }
    let stale = false
    const timer = setTimeout(() => {
      window.api.searchHistory
        .suggest(q)
        .then((s) => !stale && setSuggestions(s.slice(0, 8)))
        .catch(() => {})
    }, 180)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [query, ran])

  // Close the dropdown on an outside click, the way the other popovers behave.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  async function run(raw: string): Promise<void> {
    const q = raw.trim()
    if (!q) return
    setOpen(false)
    setHighlight(-1)
    setBusy(true)
    setDiscovery({})
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
      // History is for searches, not pasted links — a URL is not something
      // anyone wants suggested back to them.
      if (!/^https?:\/\//i.test(q)) {
        window.api.searchHistory
          .record(q)
          .then(loadRecent)
          .catch(() => {})
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err))
      setResults([])
      setRan(q)
    } finally {
      setBusy(false)
    }
  }

  function submit(e: React.FormEvent): void {
    e.preventDefault()
    void run(highlight >= 0 && shown[highlight] ? shown[highlight] : query)
  }

  // Arriving with a query (from the import's unmatched list) runs it straight
  // away — the user already asked for this search by clicking through.
  useEffect(() => {
    if (initial?.trim()) form.current?.requestSubmit()
  }, [initial])

  // Opening Playlists or Artists pulls that tab's own results once.
  useEffect(() => {
    if (tab !== 'playlists' && tab !== 'artists') return
    const kind = tab === 'playlists' ? 'playlist' : 'artist'
    const key = `${kind}:${ran}`
    if (!ran || discovery[key]) return
    let stale = false
    // The flag is what tells the tab to show its skeleton while the request is
    // in flight — the same external-system case the rule allows.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDiscoveryBusy(true)
    window.api.searchHistory
      .typed(ran, kind)
      .then((d) => !stale && setDiscovery((prev) => ({ ...prev, [key]: d })))
      .catch((err) => !stale && toast(err instanceof Error ? err.message : String(err)))
      .finally(() => !stale && setDiscoveryBusy(false))
    return () => {
      stale = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, ran])

  const shown = query.trim() ? suggestions : recent
  const tracks = forTab(results, tab)
  const found = discovery[`${tab === 'playlists' ? 'playlist' : 'artist'}:${ran}`] ?? []

  function onKeyDown(e: React.KeyboardEvent): void {
    if (!open || !shown.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => (h + 1) % shown.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => (h <= 0 ? shown.length - 1 : h - 1))
    } else if (e.key === 'Escape') {
      setOpen(false)
      setHighlight(-1)
    }
  }

  return (
    <div className="view-enter px-6 py-6">
      <div className="mb-6">
        <PageTitle sub="Songs, albums, or any YouTube video and playlist link">Search</PageTitle>
      </div>

      <form ref={form} onSubmit={submit} className="mb-6 flex gap-2">
        <div className="relative flex-1" ref={box}>
          <Search
            size={16}
            className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-dust"
          />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setHighlight(-1)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder="What do you want to listen to?"
            className="w-full rounded-full border border-line bg-panel py-3 pr-4 pl-11 text-sm outline-none transition-colors placeholder:text-dust focus:border-dust"
          />

          {open && shown.length > 0 && (
            <div className="absolute top-full right-0 left-0 z-30 mt-2 overflow-hidden rounded-xl border border-line bg-panel py-1 shadow-2xl shadow-ink/60">
              {!query.trim() && (
                <div className="flex items-center justify-between px-4 pt-1 pb-2">
                  <span className="eyebrow">Recent searches</span>
                  <button
                    type="button"
                    onClick={() => {
                      window.api.searchHistory
                        .clear()
                        .then(() => {
                          setRecent([])
                          setOpen(false)
                          toast('Search history cleared')
                        })
                        .catch(() => {})
                    }}
                    className="flex items-center gap-1.5 text-[11px] text-ash transition-colors hover:text-chalk"
                  >
                    <Trash2 size={11} /> Clear
                  </button>
                </div>
              )}
              {shown.map((s, i) => (
                <button
                  key={s}
                  type="button"
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => {
                    setQuery(s)
                    void run(s)
                  }}
                  className={`flex w-full items-center gap-3 px-4 py-2 text-left text-[13px] transition-colors ${
                    highlight === i ? 'bg-lifted text-chalk' : 'text-ash hover:text-chalk'
                  }`}
                >
                  {query.trim() ? (
                    <Search size={13} className="shrink-0 text-dust" />
                  ) : (
                    <Clock size={13} className="shrink-0 text-dust" />
                  )}
                  <span className="truncate">{s}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="submit"
          disabled={busy || !query.trim()}
          className="rounded-full bg-ember px-6 text-[13px] font-semibold text-ink transition-transform duration-150 ease-[cubic-bezier(.22,1,.36,1)] hover:scale-[1.03] active:scale-95 disabled:scale-100 disabled:opacity-25"
        >
          {busy ? 'Searching' : 'Search'}
        </button>
      </form>

      {ran && !busy && (
        <div className="mb-6 flex gap-1.5 border-b border-line pb-3">
          {TABS.map((t) => {
            const on = tab === t.id
            const count =
              t.id === 'songs' || t.id === 'videos' ? forTab(results, t.id).length : undefined
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                aria-current={on ? 'true' : undefined}
                className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors duration-150 ${
                  on ? 'bg-ember text-ink' : 'text-ash hover:bg-panel hover:text-chalk'
                }`}
              >
                {t.label}
                {count !== undefined && (
                  <span className={`font-mono text-[11px] ${on ? 'text-ink/70' : 'text-dust'}`}>
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {busy && <RowSkeletons />}

      {!busy && (tab === 'songs' || tab === 'videos') && tracks.length > 0 && (
        <>
          <Eyebrow
            action={
              <div className="flex gap-2">
                <button
                  onClick={() => playNow(tracks)}
                  className="rounded-full bg-lifted px-3.5 py-1 text-[11px] font-medium transition-colors hover:bg-line"
                >
                  Play all
                </button>
                <button
                  onClick={() => addToQueue(tracks)}
                  className="rounded-full border border-line px-3.5 py-1 text-[11px] font-medium transition-colors hover:border-dust"
                >
                  Queue all
                </button>
              </div>
            }
          >
            {tracks.length} {tab === 'songs' ? 'songs' : 'results'}
          </Eyebrow>
          {tracks.map((t, i) => (
            <TrackRow key={t.videoId} track={t} list={tracks} index={i} />
          ))}
        </>
      )}

      {!busy && (tab === 'playlists' || tab === 'artists') && (
        <>
          {discoveryBusy && <RowSkeletons count={5} />}
          {!discoveryBusy &&
            found.map((d) => (
              <div
                key={d.id}
                className="group flex items-center gap-3 rounded-lg p-2 transition-colors duration-150 hover:bg-panel"
              >
                <Artwork
                  src={d.thumbnailUrl}
                  size="md"
                  rounded={d.kind === 'artist' ? 'rounded-full' : 'rounded-lg'}
                />
                <button
                  onClick={() => {
                    // A playlist opens through the existing paste-a-URL path; an
                    // artist opens the local artist page for what we already have.
                    if (d.kind === 'playlist') {
                      setQuery(d.url)
                      void run(d.url)
                    } else {
                      go({ kind: 'artist', name: d.title.replace(/\s*-\s*Topic$/, '') })
                    }
                  }}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block truncate text-[13px] font-medium">{d.title}</span>
                  <span className="block truncate text-xs text-ash">{d.subtitle}</span>
                </button>
                {d.kind === 'artist' ? (
                  <User size={15} className="mr-2 shrink-0 text-dust" />
                ) : (
                  <ListMusic size={15} className="mr-2 shrink-0 text-dust" />
                )}
              </div>
            ))}
          {!discoveryBusy && !found.length && (
            <Empty
              icon={tab === 'artists' ? User : ListMusic}
              title={`No ${tab} for ${ran}`}
              hint="YouTube returned none for this search. Try a different wording."
            />
          )}
        </>
      )}

      {!busy && tab === 'songs' && ran && results.length > 0 && !tracks.length && (
        <Empty
          icon={SearchX}
          title="No songs in these results"
          hint="Everything matched looks like a video. Try the Videos tab."
        />
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
