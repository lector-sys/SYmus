import { useEffect, useRef, useState } from 'react'
import { Search, SearchX } from 'lucide-react'
import type { Track } from '../../preload'
import { usePlayer } from './store'
import TrackRow from './TrackRow'
import { Empty, Eyebrow, PageTitle, RowSkeletons } from './ui'

export default function SearchView({ initial }: { initial?: string }): React.JSX.Element {
  const [query, setQuery] = useState(initial ?? '')
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

  // Arriving with a query (from the import's unmatched list) runs it straight
  // away — the user already asked for this search by clicking through.
  const form = useRef<HTMLFormElement>(null)
  useEffect(() => {
    if (initial?.trim()) form.current?.requestSubmit()
  }, [initial])

  return (
    <div className="view-enter px-6 py-6">
      <div className="mb-6">
        <PageTitle sub="Songs, albums, or any YouTube video and playlist link">Search</PageTitle>
      </div>

      <form ref={form} onSubmit={submit} className="mb-8 flex gap-2">
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
