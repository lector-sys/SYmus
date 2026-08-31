import { useState } from 'react'
import { ListEnd, ListPlus, ListVideo } from 'lucide-react'
import type { Track } from '../../preload'
import { fmt, usePlayer } from './store'
import PlayerBar from './PlayerBar'
import Queue from './Queue'

export default function App(): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Track[]>([])
  const [busy, setBusy] = useState(false)
  const [showQueue, setShowQueue] = useState(true)
  const { playNow, playNext, addToQueue, toast, toasts } = usePlayer()

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!query.trim()) return
    setBusy(true)
    try {
      // A pasted link resolves to its own tracks (whole playlist unless it is an
      // RD… mix); anything else is a search.
      if (/^https?:\/\//i.test(query.trim())) {
        const { name, tracks } = await window.api.resolveUrl(query)
        setResults(tracks)
        if (name) toast(`Loaded "${name}" — ${tracks.length} tracks`)
      } else {
        setResults(await window.api.search(query))
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err))
      setResults([])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100">
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex gap-2 border-b border-zinc-800 p-4">
            <form onSubmit={submit} className="flex flex-1 gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search YouTube, or paste a video / playlist URL"
                className="flex-1 rounded-md bg-zinc-900 px-3 py-2 text-sm outline-none placeholder:text-zinc-600 focus:ring-1 focus:ring-zinc-600"
              />
              <button
                type="submit"
                disabled={busy}
                className="rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 disabled:opacity-40"
              >
                {busy ? 'Searching…' : 'Search'}
              </button>
            </form>
            <button
              onClick={() => setShowQueue((v) => !v)}
              title="Toggle queue"
              className="rounded-md px-2 text-zinc-400 hover:text-zinc-100"
            >
              <ListVideo size={18} />
            </button>
          </header>

          <main className="flex-1 overflow-y-auto p-2">
            {results.length > 1 && (
              <div className="flex gap-2 px-2 pb-2">
                <button
                  onClick={() => playNow(results)}
                  className="rounded-full bg-green-500 px-4 py-1.5 text-sm font-medium text-zinc-950 hover:bg-green-400"
                >
                  Play all
                </button>
                <button
                  onClick={() => addToQueue(results)}
                  className="rounded-full border border-zinc-700 px-4 py-1.5 text-sm hover:border-zinc-500"
                >
                  Queue all
                </button>
              </div>
            )}

            {results.map((t, i) => (
              <div
                key={t.videoId}
                className="group flex items-center gap-3 rounded-md p-2 hover:bg-zinc-900"
              >
                <img src={t.thumbnailUrl} alt="" className="h-10 w-16 rounded object-cover" />
                <button onClick={() => playNow(results, i)} className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-sm">{t.title}</span>
                  <span className="block truncate text-xs text-zinc-500">{t.artist}</span>
                </button>
                <button
                  onClick={() => playNext([t])}
                  title="Play next"
                  className="text-zinc-500 opacity-0 hover:text-zinc-100 group-hover:opacity-100"
                >
                  <ListPlus size={16} />
                </button>
                <button
                  onClick={() => addToQueue([t])}
                  title="Add to queue"
                  className="text-zinc-500 opacity-0 hover:text-zinc-100 group-hover:opacity-100"
                >
                  <ListEnd size={16} />
                </button>
                <span className="w-10 text-right text-xs tabular-nums text-zinc-500">
                  {t.duration ? fmt(t.duration) : 'live'}
                </span>
              </div>
            ))}
          </main>
        </div>

        {showQueue && <Queue />}
      </div>

      <PlayerBar />

      <div className="pointer-events-none fixed bottom-24 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="rounded-md bg-zinc-800 px-4 py-2 text-sm shadow-lg ring-1 ring-zinc-700"
          >
            {t.message}
          </div>
        ))}
      </div>
    </div>
  )
}
