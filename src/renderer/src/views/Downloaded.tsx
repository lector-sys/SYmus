import { useState } from 'react'
import { HardDriveDownload, Play, Shuffle, Trash2 } from 'lucide-react'
import { usePlayer } from '../store'
import { useLibrary } from '../useLibrary'
import TrackRow from '../TrackRow'
import { Empty, Eyebrow, PageTitle, RowSkeletons } from '../ui'

/**
 * Bytes as something readable. Binary units, because that is what disk tools report.
 *
 * Deliberately not exported: exporting a non-component from a component file
 * breaks fast refresh. If the Settings page needs it too, it belongs in ui.tsx.
 */
function formatBytes(bytes: number): string {
  if (!bytes) return '0 MB'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const power = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** power
  // Whole numbers past a gigabyte read as noise at two decimals.
  return `${value.toFixed(power <= 1 ? 0 : 1)} ${units[power]}`
}

export default function Downloaded(): React.JSX.Element {
  const { data: tracks, loading } = useLibrary(() => window.api.offline.list(), [])
  const { playNow, toggleShuffle, shuffle, libraryChanged, toast } = usePlayer()
  const [clearing, setClearing] = useState(false)

  const total = tracks.reduce((sum, t) => sum + t.bytes, 0)

  const guard = (p: Promise<unknown>): void => {
    p.then(libraryChanged).catch((err) => toast(err instanceof Error ? err.message : String(err)))
  }

  async function clearAll(): Promise<void> {
    setClearing(true)
    try {
      const dropped = await window.api.offline.clearAll()
      toast(dropped ? `Cleared ${dropped} cached tracks` : 'Nothing was cached')
      libraryChanged()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err))
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className="view-enter px-6 py-6">
      <div className="mb-6 flex items-end gap-4">
        <div className="flex-1">
          <PageTitle
            sub={
              loading
                ? 'Reading the cache…'
                : `${tracks.length} track${tracks.length === 1 ? '' : 's'} · ${formatBytes(total)} on disk`
            }
          >
            Downloaded
          </PageTitle>
        </div>
        <button
          onClick={() => playNow(tracks)}
          disabled={!tracks.length}
          className="flex items-center gap-2 rounded-full bg-ember px-5 py-2.5 text-[13px] font-semibold text-ink transition-transform duration-150 ease-[cubic-bezier(.22,1,.36,1)] hover:scale-[1.03] active:scale-95 disabled:scale-100 disabled:opacity-25"
        >
          <Play size={15} fill="currentColor" /> Play
        </button>
        <button
          onClick={() => {
            if (!shuffle) toggleShuffle()
            playNow(tracks)
          }}
          disabled={!tracks.length}
          className="flex items-center gap-2 rounded-full border border-line px-5 py-2.5 text-[13px] font-medium transition-colors hover:border-dust hover:bg-panel disabled:opacity-25"
        >
          <Shuffle size={15} /> Shuffle
        </button>
      </div>

      <p className="mb-6 max-w-2xl text-xs leading-relaxed text-ash">
        Audio you have already played, kept on disk so it plays without a network. Saved copies are
        used automatically, even when you are offline.
      </p>

      {loading ? (
        <RowSkeletons />
      ) : tracks.length ? (
        <>
          <Eyebrow
            action={
              <button
                onClick={clearAll}
                disabled={clearing}
                className="flex items-center gap-1.5 rounded-full border border-line px-3.5 py-1 text-[11px] font-medium transition-colors hover:border-dust disabled:opacity-40"
              >
                <Trash2 size={12} />
                {clearing ? 'Clearing' : 'Clear all'}
              </button>
            }
          >
            {formatBytes(total)} cached
          </Eyebrow>

          {tracks.map((t, i) => (
            <div key={t.videoId} className="group/row relative flex items-center">
              <div className="min-w-0 flex-1">
                <TrackRow track={t} list={tracks} index={i} showGenre />
              </div>
              <div className="flex shrink-0 items-center gap-3 pr-3 pl-1">
                <span className="w-16 text-right font-mono text-[11px] tabular-nums text-ash">
                  {formatBytes(t.bytes)}
                </span>
                <button
                  onClick={() => guard(window.api.offline.remove(t.videoId))}
                  title="Remove the offline copy"
                  className="text-ash opacity-0 transition-colors hover:text-chalk group-hover/row:opacity-100"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </>
      ) : (
        <Empty
          icon={HardDriveDownload}
          title="Nothing saved for offline"
          hint="Play a track, then use Save for offline on its row. Only audio you have already listened to can be kept."
        />
      )}
    </div>
  )
}
