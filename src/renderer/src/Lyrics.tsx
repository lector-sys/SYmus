import { useEffect, useRef, useState } from 'react'
import { Mic2 } from 'lucide-react'
// Imported from the feature's own preload slice rather than the preload barrel,
// so adding lyrics never means editing a shared file.
import type { LyricsResult } from '../../preload/features/lyrics'
import { usePlayer } from './store'
import { Empty, Eyebrow } from './ui'

/**
 * Playback position, read straight off the <audio> element.
 *
 * The position lives as local state inside PlayerBar and is not in the store, so
 * this subscribes to the element's own `timeupdate` rather than duplicating that
 * state. timeupdate fires about four times a second, which is more than enough
 * to move a highlight between lines and far cheaper than a rAF loop.
 */
function usePlaybackTime(active: boolean): number {
  const [time, setTime] = useState(0)

  useEffect(() => {
    if (!active) return
    const el = document.querySelector('audio')
    if (!el) return
    const onTime = (): void => setTime(el.currentTime)
    el.addEventListener('timeupdate', onTime)
    el.addEventListener('seeked', onTime)
    onTime()
    return () => {
      el.removeEventListener('timeupdate', onTime)
      el.removeEventListener('seeked', onTime)
    }
  }, [active])

  return time
}

export default function Lyrics(): React.JSX.Element {
  const current = usePlayer((s) => s.current)
  const [result, setResult] = useState<LyricsResult | null>(null)
  const [loading, setLoading] = useState(false)
  const activeRef = useRef<HTMLParagraphElement>(null)

  const synced = result?.lines ?? null
  const time = usePlaybackTime(Boolean(synced))

  useEffect(() => {
    if (!current) {
      // Clearing when playback stops. Synchronous by necessity: there is no
      // request to hang it off, and the rule guards against cascading renders
      // from derived state, which a one-shot reset is not.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResult(null)
      return
    }
    let stale = false
    setLoading(true)
    window.api.lyrics
      .get({
        videoId: current.videoId,
        title: current.title,
        artist: current.artist,
        duration: current.duration
      })
      .then((r) => {
        if (!stale) setResult(r)
      })
      .catch(() => {
        if (!stale) setResult(null)
      })
      .finally(() => {
        if (!stale) setLoading(false)
      })
    return () => {
      stale = true
    }
  }, [current])

  // The last line whose timestamp has passed.
  const activeIndex = synced ? synced.findLastIndex((l) => l.time <= time + 0.15) : -1

  useEffect(() => {
    const el = activeRef.current
    if (!el) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' })
  }, [activeIndex])

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-line bg-panel">
      <div className="px-4 pt-4">
        <Eyebrow>Lyrics</Eyebrow>
      </div>

      {!current ? (
        <Empty icon={Mic2} title="Nothing playing" hint="Lyrics appear here once a track starts." />
      ) : loading ? (
        <div className="space-y-3 px-4 py-2">
          {Array.from({ length: 10 }, (_, i) => (
            <div
              key={i}
              className="shimmer h-3 rounded"
              style={{ width: `${90 - ((i * 37) % 45)}%` }}
            />
          ))}
        </div>
      ) : result?.status === 'found' ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8">
          {synced ? (
            synced.map((line, i) => (
              <p
                key={`${line.time}-${i}`}
                ref={i === activeIndex ? activeRef : undefined}
                className={`py-1.5 text-[15px] leading-snug transition-colors duration-300 ${
                  i === activeIndex
                    ? 'font-semibold text-ember'
                    : i < activeIndex
                      ? 'text-dust'
                      : 'text-ash'
                }`}
              >
                {/* Instrumental breaks come through as a lone note glyph. */}
                {line.text || '♪'}
              </p>
            ))
          ) : (
            <p className="text-[15px] leading-relaxed whitespace-pre-wrap text-ash">
              {result.plain}
            </p>
          )}
          <p className="mt-6 font-mono text-[11px] text-dust">Lyrics from LRCLIB</p>
        </div>
      ) : (
        <Empty
          icon={Mic2}
          title="No lyrics found"
          hint={`LRCLIB has nothing for "${current.title}". Instrumentals, mixes and live sets usually have none.`}
        />
      )}
    </aside>
  )
}
