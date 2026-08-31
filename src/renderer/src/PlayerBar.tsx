import { useEffect, useRef, useState } from 'react'
import {
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX
} from 'lucide-react'
import { fmt, usePlayer } from './store'

// Both halves must set the colour: a base `text-zinc-400` here would fight
// `text-green-400` on a rule the stylesheet order decides, not the class list.
const btn = 'rounded-full p-2 disabled:opacity-30'
const idle = 'text-zinc-400 hover:text-zinc-100'
const active = 'text-green-400 hover:text-green-300'

export default function PlayerBar(): React.JSX.Element {
  const audio = useRef<HTMLAudioElement>(null)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const s = usePlayer()

  // Resolve before playing: <audio> only ever reports "source failed", while
  // prepare() names the reason and warms the cache the protocol handler reads.
  useEffect(() => {
    const el = audio.current
    if (!el) return
    if (!s.current) {
      el.removeAttribute('src')
      el.load()
      return
    }
    const track = s.current
    let stale = false
    window.api
      .prepare(track.videoId)
      .then(() => {
        if (stale) return
        el.src = window.api.streamUrl(track.videoId)
        // Rejects with AbortError whenever the next track replaces this src;
        // a genuine failure arrives on the element's error event instead.
        el.play().catch(() => {})
      })
      .catch((err: unknown) => {
        if (stale) return
        s.toast(`Skipping "${track.title}" — ${err instanceof Error ? err.message : err}`)
        s.next(true)
      })
    return () => {
      stale = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.current])

  useEffect(() => {
    const el = audio.current
    if (!el || !el.getAttribute('src')) return
    if (s.playing) el.play().catch(() => {})
    else el.pause()
  }, [s.playing])

  useEffect(() => {
    const el = audio.current
    if (!el) return
    el.volume = s.volume
    el.muted = s.muted
  }, [s.volume, s.muted])

  function seek(to: number): void {
    if (audio.current) audio.current.currentTime = to
    setPosition(to)
  }

  /** Every player restarts the track when there is nothing behind it. */
  function previous(): void {
    if (!s.previous()) seek(0)
  }

  const RepeatIcon = s.repeat === 'one' ? Repeat1 : Repeat

  return (
    <footer className="flex h-20 items-center gap-4 border-t border-zinc-800 bg-zinc-900/60 px-4">
      <audio
        ref={audio}
        onLoadStart={() => {
          setPosition(0)
          setDuration(0)
        }}
        onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
        onDurationChange={(e) => setDuration(e.currentTarget.duration)}
        onPlay={() => s.setPlaying(true)}
        onPause={() => s.setPlaying(false)}
        onEnded={() => {
          if (s.repeat !== 'one') return s.next()
          seek(0)
          audio.current?.play().catch(() => {})
        }}
        onError={() => {
          if (!s.current) return
          s.toast(`Skipping "${s.current.title}" — playback failed`)
          s.next(true)
        }}
      />

      <div className="flex w-64 min-w-0 items-center gap-3">
        {s.current && (
          <>
            <img src={s.current.thumbnailUrl} alt="" className="h-12 w-12 rounded object-cover" />
            <div className="min-w-0">
              <p className="truncate text-sm">{s.current.title}</p>
              <p className="truncate text-xs text-zinc-500">{s.current.artist}</p>
            </div>
          </>
        )}
      </div>

      <div className="flex flex-1 flex-col items-center gap-1">
        <div className="flex items-center gap-1">
          <button
            className={`${btn} ${s.shuffle ? active : idle}`}
            onClick={s.toggleShuffle}
            title="Shuffle"
          >
            <Shuffle size={16} />
          </button>
          <button
            className={`${btn} ${idle}`}
            onClick={previous}
            disabled={!s.current}
            title="Previous"
          >
            <SkipBack size={18} fill="currentColor" />
          </button>
          <button
            className="rounded-full bg-zinc-100 p-2 text-zinc-900 disabled:opacity-30"
            onClick={() => s.setPlaying(!s.playing)}
            disabled={!s.current}
            title={s.playing ? 'Pause' : 'Play'}
          >
            {s.playing ? (
              <Pause size={18} fill="currentColor" />
            ) : (
              <Play size={18} fill="currentColor" />
            )}
          </button>
          <button
            className={`${btn} ${idle}`}
            onClick={() => s.next()}
            disabled={!s.current && !s.queue.length}
            title="Next"
          >
            <SkipForward size={18} fill="currentColor" />
          </button>
          <button
            className={`${btn} ${s.repeat !== 'off' ? active : idle}`}
            onClick={s.cycleRepeat}
            title={`Repeat: ${s.repeat}`}
          >
            <RepeatIcon size={16} />
          </button>
        </div>

        <div className="flex w-full max-w-xl items-center gap-2">
          <span className="w-10 text-right text-xs tabular-nums text-zinc-500">
            {fmt(position)}
          </span>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.5}
            value={position}
            onChange={(e) => seek(Number(e.target.value))}
            disabled={!duration}
            className="h-1 flex-1 accent-zinc-100"
          />
          <span className="w-10 text-xs tabular-nums text-zinc-500">{fmt(duration)}</span>
        </div>
      </div>

      <div className="flex w-64 items-center justify-end gap-2">
        <button className={`${btn} ${idle}`} onClick={s.toggleMute} title="Mute">
          {s.muted || s.volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={s.muted ? 0 : s.volume}
          onChange={(e) => s.setVolume(Number(e.target.value))}
          className="h-1 w-24 accent-zinc-100"
        />
      </div>
    </footer>
  )
}
