import { useEffect, useState } from 'react'
import { AlertTriangle, Check, Download, KeyRound, Loader2 } from 'lucide-react'
import type { ImportProgress, ImportResult, Source } from '../../preload'
import { usePlayer, useNav } from './store'
import { Eyebrow, PageTitle } from './ui'

const SOURCE_LABEL: Record<Source, string> = {
  youtube: 'YouTube',
  spotify: 'Spotify',
  apple: 'Apple Music'
}

/** Named so the message can say which keys are missing without leaking values. */
const SOURCE_KEYS: Record<Source, string[]> = {
  youtube: [],
  spotify: ['SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET'],
  apple: ['APPLE_MUSIC_DEVELOPER_TOKEN']
}

export default function Import(): React.JSX.Element {
  const [url, setUrl] = useState('')
  const [detected, setDetected] = useState<{ source: Source | null; configured: boolean }>({
    source: null,
    configured: false
  })
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { libraryChanged, toast } = usePlayer()
  const go = useNav((s) => s.go)

  const busy = progress !== null && progress.stage !== 'done'

  // Detect as the link is typed, so the source and any missing keys are known
  // before the user commits to an import.
  useEffect(() => {
    const value = url.trim()
    if (!value) {
      // Clearing the box resets the badge. Synchronous by necessity: there is no
      // request to hang this off, and the rule's concern is cascading renders
      // from derived state, which a one-shot reset is not.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDetected({ source: null, configured: false })
      return
    }
    let stale = false
    const timer = setTimeout(() => {
      window.api
        .detectImport(value)
        .then((d) => !stale && setDetected(d))
        .catch(() => {})
    }, 200)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [url])

  async function run(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    const value = url.trim()
    if (!value || busy) return
    setError(null)
    setResult(null)
    setProgress({ stage: 'fetching', done: 0, total: 0, name: null })
    try {
      const res = await window.api.importPlaylist(value, setProgress)
      setResult(res)
      setUrl('')
      libraryChanged()
      toast(`Imported ${res.name} — ${res.imported} tracks`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setProgress(null)
    }
  }

  const pct =
    progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0
  const unconfigured = detected.source && !detected.configured

  return (
    <div className="view-enter px-6 py-6">
      <div className="mb-6">
        <PageTitle sub="Bring a playlist over from YouTube, Spotify, or Apple Music">
          Import a playlist
        </PageTitle>
      </div>

      <form onSubmit={run} className="mb-4 flex gap-2">
        <div className="relative flex-1">
          <Download
            size={16}
            className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-dust"
          />
          <input
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste a playlist link"
            className="w-full rounded-full border border-line bg-panel py-3 pr-28 pl-11 text-sm outline-none transition-colors placeholder:text-dust focus:border-dust"
          />
          {detected.source && (
            <span className="absolute top-1/2 right-4 -translate-y-1/2 rounded-full bg-lifted px-2.5 py-1 text-[11px] text-ash">
              {SOURCE_LABEL[detected.source]}
            </span>
          )}
        </div>
        <button
          type="submit"
          disabled={busy || !detected.source || !detected.configured}
          className="rounded-full bg-ember px-6 text-[13px] font-semibold text-ink transition-transform duration-150 ease-[cubic-bezier(.22,1,.36,1)] hover:scale-[1.03] active:scale-95 disabled:scale-100 disabled:opacity-25"
        >
          {busy ? 'Importing' : 'Import'}
        </button>
      </form>

      {url.trim() && !detected.source && !busy && (
        <p className="mb-6 text-xs text-ash">
          Not a playlist link we recognise. Paste one from youtube.com, spotify.com, or
          music.apple.com.
        </p>
      )}

      {unconfigured && (
        <div className="mb-6 flex gap-3 rounded-lg border border-line bg-panel p-4">
          <KeyRound size={16} className="mt-0.5 shrink-0 text-ember" />
          <div className="text-[13px] leading-relaxed">
            <p className="font-medium">{SOURCE_LABEL[detected.source!]} import is not configured</p>
            <p className="mt-1 text-ash">
              Add {SOURCE_KEYS[detected.source!].join(' and ')} to a{' '}
              <code className="rounded bg-lifted px-1 font-mono text-[11px]">.env</code> file, then
              restart SYmuS. See{' '}
              <code className="rounded bg-lifted px-1 font-mono text-[11px]">.env.example</code> for
              where it goes and how to get the keys.
            </p>
          </div>
        </div>
      )}

      {progress && (
        <div className="mb-6 rounded-lg border border-line bg-panel p-4">
          <div className="flex items-center gap-2.5 text-[13px]">
            <Loader2 size={15} className="animate-spin text-ember" />
            {progress.stage === 'fetching'
              ? 'Reading the playlist…'
              : `Resolving ${progress.done} of ${progress.total} tracks…`}
          </div>
          {progress.total > 0 && (
            <>
              <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-lifted">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-flare to-ember transition-[width] duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="mt-2 font-mono text-[11px] text-ash">
                {pct}%{progress.name ? ` · ${progress.name}` : ''}
              </p>
            </>
          )}
          <p className="mt-3 text-xs leading-relaxed text-ash">
            Only track names and artists are read from the source. Every track is matched to and
            played from YouTube.
          </p>
        </div>
      )}

      {error && (
        <div className="mb-6 flex gap-3 rounded-lg border border-line bg-panel p-4 text-[13px]">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-ember" />
          <p className="leading-relaxed">{error}</p>
        </div>
      )}

      {result && (
        <div className="mb-6">
          <div className="mb-4 flex gap-3 rounded-lg border border-line bg-panel p-4">
            <Check size={16} className="mt-0.5 shrink-0 text-ember" />
            <div className="text-[13px] leading-relaxed">
              <p className="font-medium">
                Imported {result.imported} track{result.imported === 1 ? '' : 's'} into{' '}
                {result.name}
              </p>
              <button
                onClick={() => go({ kind: 'playlist', id: result.playlistId, title: result.name })}
                className="mt-1 text-ember hover:text-flare"
              >
                Open the playlist
              </button>
            </div>
          </div>

          {result.unmatched.length > 0 && (
            <>
              <Eyebrow>{result.unmatched.length} not matched</Eyebrow>
              <p className="mb-3 text-xs leading-relaxed text-ash">
                No confident YouTube match for these. Search for them by hand and add them to the
                playlist.
              </p>
              {result.unmatched.map((t, i) => (
                <div
                  key={`${t.title}-${i}`}
                  className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-panel"
                >
                  <span className="w-6 shrink-0 text-right font-mono text-[11px] text-dust">
                    {i + 1}
                  </span>
                  <button
                    onClick={() =>
                      go({ kind: 'search', query: [t.title, t.artist].filter(Boolean).join(' ') })
                    }
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block truncate text-[13px]">{t.title}</span>
                    <span className="block truncate text-xs text-ash">
                      {t.artist ?? 'Unknown artist'}
                      {t.album ? ` · ${t.album}` : ''}
                    </span>
                  </button>
                  <span className="shrink-0 text-[11px] text-dust">Search</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
