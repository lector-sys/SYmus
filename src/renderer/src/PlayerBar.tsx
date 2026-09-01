import { useEffect, useRef, useState } from 'react'
import {
  Heart,
  Infinity as InfinityIcon,
  ListVideo,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Mic2,
  Minimize2,
  Moon,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX
} from 'lucide-react'
import { fmt, usePlayer } from './store'
import { useAudioEngine } from './audio'
import { Artwork } from './ui'

const icon = 'flex h-8 w-8 items-center justify-center rounded-full transition-colors duration-150'
const idle = 'text-ash hover:text-chalk'
const lit = 'text-ember hover:text-flare'

/**
 * Track scrubber. `value` follows playback until a drag starts, then the drag
 * owns the handle — otherwise the next timeupdate yanks it back under the cursor
 * mid-gesture.
 */
function Scrubber({
  value,
  max,
  onSeek,
  disabled
}: {
  value: number
  max: number
  onSeek: (to: number) => void
  disabled?: boolean
}): React.JSX.Element {
  const [dragging, setDragging] = useState<number | null>(null)
  const shown = dragging ?? value
  const pct = max > 0 ? Math.min(100, (shown / max) * 100) : 0

  const commit = (): void => {
    if (dragging !== null) onSeek(dragging)
    setDragging(null)
  }

  return (
    <div className="group/bar relative flex h-3 w-full items-center">
      <div className="h-1 w-full overflow-hidden rounded-full bg-lifted">
        <div
          className="h-full rounded-full bg-gradient-to-r from-flare to-ember"
          style={{
            width: `${pct}%`,
            transition: dragging === null ? 'width 220ms linear' : 'none'
          }}
        />
      </div>
      <span
        aria-hidden
        className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 rounded-full bg-chalk opacity-0 shadow transition-opacity duration-150 group-hover/bar:opacity-100"
        style={{ left: `${pct}%` }}
      />
      <input
        type="range"
        min={0}
        max={max || 0}
        step={0.25}
        value={shown}
        disabled={disabled}
        aria-label="Seek"
        onChange={(e) => setDragging(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
      />
    </div>
  )
}

/** Sleep timer. Minutes, or "when this track ends". */
function SleepTimer(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const { sleepAt, sleepOnTrackEnd, setSleep } = usePlayer()
  const ref = useRef<HTMLDivElement>(null)
  const armed = sleepAt !== null || sleepOnTrackEnd

  // Minutes left, held in state rather than computed during render: reading the
  // clock while rendering is impure and makes the component's output depend on
  // when React happened to run it.
  const [remaining, setRemaining] = useState<number | null>(null)
  useEffect(() => {
    if (!sleepAt) {
      // Clearing the countdown when the timer is turned off. Reading the clock
      // is the external system here; there is nothing to derive this from.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRemaining(null)
      return
    }
    const update = (): void =>
      setRemaining(Math.max(0, Math.round((sleepAt - Date.now()) / 60_000)))
    update()
    const timer = setInterval(update, 30_000)
    return () => clearInterval(timer)
  }, [sleepAt])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const label = sleepOnTrackEnd
    ? 'Stopping at the end of this track'
    : remaining !== null
      ? `Stopping in about ${remaining} min`
      : 'Sleep timer'

  const item = 'block w-full rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-lifted'

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        title={label}
        className={`${icon} ${armed ? lit : idle}`}
      >
        <Moon size={16} />
      </button>
      {open && (
        <div className="absolute right-0 bottom-full z-40 mb-2 w-52 rounded-lg border border-line bg-panel p-1 shadow-2xl shadow-ink/70">
          <p className="px-2.5 py-1.5 text-[11px] text-ash">{label}</p>
          <div className="my-1 h-px bg-line" />
          {[15, 30, 45, 60].map((m) => (
            <button
              key={m}
              onClick={() => {
                setSleep(m)
                setOpen(false)
              }}
              className={item}
            >
              In {m} minutes
            </button>
          ))}
          <button
            onClick={() => {
              setSleep('track')
              setOpen(false)
            }}
            className={item}
          >
            At the end of this track
          </button>
          {armed && (
            <>
              <div className="my-1 h-px bg-line" />
              <button
                onClick={() => {
                  setSleep(null)
                  setOpen(false)
                }}
                className={`${item} text-ember`}
              >
                Turn off
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default function PlayerBar({
  onToggleQueue,
  queueOpen
}: {
  onToggleQueue: () => void
  queueOpen: boolean
}): React.JSX.Element {
  const s = usePlayer()
  const { deckA, deckB, position, duration, seek, current: liveDeck } = useAudioEngine(s.crossfade)

  // Media keys and tray clicks. Registered once and reading the store directly,
  // so the subscription does not churn on every render.
  useEffect(
    () =>
      window.api.onMedia((command) => {
        const p = usePlayer.getState()
        if (command === 'playpause') p.setPlaying(!p.playing)
        else if (command === 'next') p.next()
        else if (command === 'stop') p.setPlaying(false)
        else if (command === 'previous' && !p.previous()) {
          const el = liveDeck()
          if (el) el.currentTime = 0
        }
      }),
    [liveDeck]
  )

  // The queue has run dry. Repeat is handled inside autoplayIfIdle, which is a
  // no-op unless autoplay genuinely applies.
  useEffect(() => {
    if (s.current || s.queue.length) return
    void s.autoplayIfIdle()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.current, s.queue.length])

  // The tray menu and the OS media overlay are the two places playback shows up
  // outside the window; both are fed from here.
  useEffect(() => {
    window.api.setNowPlaying({
      title: s.current?.title ?? null,
      artist: s.current?.artist ?? null,
      playing: s.playing,
      thumbnailUrl: s.current?.thumbnailUrl ?? null
    })
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.metadata = s.current
      ? new MediaMetadata({
          title: s.current.title,
          artist: s.current.artist ?? '',
          artwork: s.current.thumbnailUrl ? [{ src: s.current.thumbnailUrl }] : []
        })
      : null
    navigator.mediaSession.playbackState = s.playing ? 'playing' : 'paused'
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.current, s.playing])

  // A wall-clock sleep timer must still fire when nothing is playing, so it
  // cannot rely on timeupdate alone.
  useEffect(() => {
    if (!s.sleepAt) return
    const timer = setTimeout(
      () => usePlayer.getState().endSleep(),
      Math.max(0, s.sleepAt - Date.now())
    )
    return () => clearTimeout(timer)
  }, [s.sleepAt])

  // Pressing Next mid-track is a negative signal for recommendations.
  const skipForward = (): void => {
    const el = liveDeck()
    if (s.current && el && el.duration > 0 && el.currentTime < el.duration * 0.5) {
      window.api.lib.skipped(s.current.videoId).catch(() => {})
    }
    s.next()
  }

  const RepeatIcon = s.repeat === 'one' ? Repeat1 : Repeat
  const VolumeIcon = s.muted || s.volume === 0 ? VolumeX : s.volume < 0.5 ? Volume1 : Volume2
  const liked = s.current ? s.liked.has(s.current.videoId) : false

  return (
    <footer className="relative z-20 flex h-[76px] shrink-0 items-center gap-6 border-t border-line bg-panel px-4">
      {/* Two decks so tracks can overlap; the engine decides which is audible. */}
      <audio ref={deckA} />
      <audio ref={deckB} />

      {/* Left: what is playing. The bloom behind the artwork is the app's one
          piece of decoration, and it exists only while sound is coming out. */}
      <div className="flex w-[26%] min-w-0 items-center gap-3">
        {s.current ? (
          <>
            <div className="relative shrink-0">
              {s.playing && (
                <span aria-hidden className="bloom absolute -inset-3 rounded-full blur-md" />
              )}
              <div className="relative">
                <Artwork src={s.current.thumbnailUrl} size="md" rounded="rounded-md" />
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium">{s.current.title}</p>
              <p className="truncate text-xs text-ash">{s.current.artist ?? 'Unknown artist'}</p>
            </div>
            <button
              onClick={() => s.current && s.toggleLike(s.current)}
              title={liked ? 'Remove from liked songs' : 'Add to liked songs'}
              className={`${icon} shrink-0 ${liked ? lit : idle}`}
            >
              <Heart size={16} fill={liked ? 'currentColor' : 'none'} />
            </button>
          </>
        ) : (
          <p className="text-xs text-dust">Nothing playing</p>
        )}
      </div>

      {/* Centre: transport. */}
      <div className="flex flex-1 flex-col items-center gap-1.5">
        <div className="flex items-center gap-2">
          <button
            className={`${icon} ${s.shuffle ? lit : idle}`}
            onClick={s.toggleShuffle}
            title={s.shuffle ? 'Shuffle on' : 'Shuffle off'}
          >
            <Shuffle size={15} />
          </button>
          <button
            className={`${icon} ${idle} disabled:opacity-30`}
            onClick={() => {
              if (!s.previous()) seek(0)
            }}
            disabled={!s.current}
            title="Previous"
          >
            <SkipBack size={17} fill="currentColor" />
          </button>
          <button
            onClick={() => s.setPlaying(!s.playing)}
            disabled={!s.current}
            title={s.playing ? 'Pause' : 'Play'}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-chalk text-ink transition-transform duration-150 ease-[cubic-bezier(.22,1,.36,1)] hover:scale-105 active:scale-95 disabled:scale-100 disabled:opacity-25"
          >
            {s.playing ? (
              <Pause size={17} fill="currentColor" />
            ) : (
              <Play size={17} fill="currentColor" className="ml-[2px]" />
            )}
          </button>
          <button
            className={`${icon} ${idle} disabled:opacity-30`}
            onClick={skipForward}
            disabled={!s.current && !s.queue.length}
            title="Next"
          >
            <SkipForward size={17} fill="currentColor" />
          </button>
          <button
            className={`${icon} ${s.repeat !== 'off' ? lit : idle}`}
            onClick={s.cycleRepeat}
            title={
              s.repeat === 'off'
                ? 'Repeat off'
                : s.repeat === 'all'
                  ? 'Repeat queue'
                  : 'Repeat this track'
            }
          >
            <RepeatIcon size={15} />
          </button>
        </div>

        <div className="flex w-full max-w-2xl items-center gap-3">
          <span className="w-9 text-right font-mono text-[11px] tabular-nums text-ash">
            {fmt(position)}
          </span>
          <Scrubber value={position} max={duration} onSeek={seek} disabled={!duration} />
          <span className="w-9 font-mono text-[11px] tabular-nums text-ash">{fmt(duration)}</span>
        </div>
      </div>

      {/* Right: output. */}
      <div className="flex w-[26%] items-center justify-end gap-1">
        <button
          onClick={s.toggleLyrics}
          title={s.lyricsOpen ? 'Hide lyrics' : 'Show lyrics'}
          className={`${icon} ${s.lyricsOpen ? lit : idle}`}
        >
          <Mic2 size={16} />
        </button>
        <button
          onClick={() => window.api.mini.toggle()}
          title="Mini player — a compact window that stays on top"
          className={`${icon} ${idle}`}
        >
          <Minimize2 size={16} />
        </button>
        <SleepTimer />
        <button
          onClick={() => s.setAutoplay(!s.autoplay)}
          title={
            s.autoplay
              ? 'Autoplay on — keeps playing similar tracks when the queue ends'
              : 'Autoplay off — playback stops when the queue ends'
          }
          className={`${icon} ${s.autoplay ? lit : idle}`}
        >
          <InfinityIcon size={17} />
        </button>
        <button
          onClick={onToggleQueue}
          title={queueOpen ? 'Hide queue' : 'Show queue'}
          className={`${icon} ${queueOpen ? 'text-chalk' : idle}`}
        >
          <ListVideo size={16} />
        </button>
        <button className={`${icon} ${idle}`} onClick={s.toggleMute} title="Mute">
          <VolumeIcon size={16} />
        </button>
        <div className="group/vol relative flex h-3 w-24 items-center">
          <div className="h-1 w-full overflow-hidden rounded-full bg-lifted">
            <div
              className="h-full rounded-full bg-ash transition-colors group-hover/vol:bg-chalk"
              style={{ width: `${(s.muted ? 0 : s.volume) * 100}%` }}
            />
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={s.muted ? 0 : s.volume}
            aria-label="Volume"
            onChange={(e) => s.setVolume(Number(e.target.value))}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </div>
      </div>
    </footer>
  )
}
