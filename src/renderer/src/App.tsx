import { useRef, useState } from 'react'
import type { Track } from '../../preload'

const fmt = (s: number): string =>
  s > 0 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : 'live'

export default function App(): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Track[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [current, setCurrent] = useState<Track | null>(null)
  const audio = useRef<HTMLAudioElement>(null)

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!query.trim()) return
    setBusy(true)
    setError(null)
    try {
      // A pasted link resolves to its own tracks; anything else is a search.
      const found = /^https?:\/\//i.test(query.trim())
        ? (await window.api.resolveUrl(query)).tracks
        : await window.api.search(query)
      setResults(found)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setResults([])
    } finally {
      setBusy(false)
    }
  }

  async function play(track: Track): Promise<void> {
    setError(null)
    setCurrent(null)
    try {
      await window.api.prepare(track.videoId)
      setCurrent(track)
    } catch (err) {
      setError(`Skipping "${track.title}" — ${err instanceof Error ? err.message : err}`)
    }
  }

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-900 p-4">
        <form onSubmit={submit} className="flex gap-2">
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
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      </header>

      <main className="flex-1 overflow-y-auto p-2">
        {results.map((t) => (
          <button
            key={t.videoId}
            onClick={() => play(t)}
            className={`flex w-full items-center gap-3 rounded-md p-2 text-left hover:bg-zinc-900 ${
              current?.videoId === t.videoId ? 'bg-zinc-900' : ''
            }`}
          >
            <img src={t.thumbnailUrl} alt="" className="h-10 w-16 rounded object-cover" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{t.title}</span>
              <span className="block truncate text-xs text-zinc-500">{t.artist}</span>
            </span>
            <span className="text-xs tabular-nums text-zinc-500">{fmt(t.duration)}</span>
          </button>
        ))}
      </main>

      <footer className="flex items-center gap-3 border-t border-zinc-900 p-3">
        {current ? (
          <>
            <img src={current.thumbnailUrl} alt="" className="h-10 w-16 rounded object-cover" />
            <span className="min-w-0 flex-1 truncate text-sm">{current.title}</span>
            <audio
              ref={audio}
              src={window.api.streamUrl(current.videoId)}
              controls
              autoPlay
              onError={() => setError(`Playback failed for "${current.title}".`)}
              className="w-[28rem]"
            />
          </>
        ) : (
          <span className="text-sm text-zinc-600">Nothing playing</span>
        )}
      </footer>
    </div>
  )
}
