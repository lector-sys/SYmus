import { useEffect, useRef, useState } from 'react'
import {
  Heart,
  Infinity as InfinityIcon,
  ListVideo,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX
} from 'lucide-react'
import { fmt, usePlayer } from './store'
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

export default function PlayerBar({
  onToggleQueue,
  queueOpen
}: {
  onToggleQueue: () => void
  queueOpen: boolean
}): React.JSX.Element {
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
        // Recorded only once the stream resolved: a track that never played is
        // not something the user listened to, and must not skew the history.
        window.api.lib
          .play(track)
          .then(() => usePlayer.getState().libraryChanged())
          .catch(() => {})
        // Session history is what stops autoplay serving the same track twice.
        usePlayer.getState().notePlayed(track.videoId)
        el.src = window.api.streamUrl(track.videoId)
        // Rejects with AbortError whenever the next track replaces this src;
        // a genuine failure arrives on the element's error event instead.
        el.play().catch(() => {})
      })
      .catch((err: unknown) => {
        if (stale) return
        s.toast(`Skipped "${track.title}" — ${err instanceof Error ? err.message : err}`)
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

  // Media keys and tray clicks. Registered once and reading the store directly,
  // so the subscription does not churn on every render.
  useEffect(
    () =>
      window.api.onMedia((command) => {
        const p = usePlayer.getState()
        if (command === 'playpause') p.setPlaying(!p.playing)
        else if (command === 'next') p.next()
        else if (command === 'stop') p.setPlaying(false)
        else if (command === 'previous' && !p.previous() && audio.current) {
          audio.current.currentTime = 0
        }
      }),
    []
  )

  // The tray menu and the OS media overlay are the two places playback shows up
  // outside the window; both are fed from here.
  useEffect(() => {
    window.api.setNowPlaying({
      title: s.current?.title ?? null,
      artist: s.current?.artist ?? null,
      playing: s.playing
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

  // The queue has run dry. Repeat is handled inside autoplayIfIdle, which is a
  // no-op unless autoplay genuinely applies.
  useEffect(() => {
    if (s.current || s.queue.length) return
    void s.autoplayIfIdle()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.current, s.queue.length])

  function seek(to: number): void {
    if (audio.current) audio.current.currentTime = to
    setPosition(to)
  }

  const RepeatIcon = s.repeat === 'one' ? Repeat1 : Repeat
  const VolumeIcon = s.muted || s.volume === 0 ? VolumeX : s.volume < 0.5 ? Volume1 : Volume2
  const liked = s.current ? s.liked.has(s.current.videoId) : false

  return (
    <footer className="relative z-20 flex h-[76px] shrink-0 items-center gap-6 border-t border-line bg-panel px-4">
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
          s.toast(`Skipped "${s.current.title}" — playback failed`)
          s.next(true)
        }}
      />

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
            onClick={() => s.next()}
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
