import { useCallback, useEffect, useRef, useState } from 'react'
import { usePlayer } from './store'

/**
 * Two-deck audio engine.
 *
 * One <audio> element cannot overlap with itself, so crossfade needs two. The
 * track that is playing lives on whichever deck loaded most recently; the other
 * holds the outgoing track while it fades.
 *
 * There is deliberately only one code path: a crossfade of 0 is a fade of zero
 * duration, not a separate branch. Two paths would mean the common case and the
 * configured case drift apart, and only one of them would stay tested.
 */

const FADE_STEP_MS = 50

interface Engine {
  deckA: React.RefObject<HTMLAudioElement | null>
  deckB: React.RefObject<HTMLAudioElement | null>
  live: 0 | 1
  position: number
  duration: number
  seek: (to: number) => void
  /** The element currently responsible for audible playback. */
  current: () => HTMLAudioElement | null
}

export function useAudioEngine(crossfadeSeconds: number): Engine {
  const deckA = useRef<HTMLAudioElement>(null)
  const deckB = useRef<HTMLAudioElement>(null)

  const [live, setLive] = useState<0 | 1>(0)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)

  // Read inside callbacks that must not re-subscribe when `live` changes.
  // Assigned in an effect, never during render — the deck-swap code sets it
  // eagerly at the moment of the swap, so it is never stale where it matters.
  const liveRef = useRef<0 | 1>(0)
  useEffect(() => {
    liveRef.current = live
  }, [live])
  const fadeTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  // Guards the early advance, or every timeupdate inside the fade window would
  // fire another next().
  const advancing = useRef(false)

  const s = usePlayer()
  const elementAt = useCallback(
    (i: 0 | 1): HTMLAudioElement | null => (i === 0 ? deckA.current : deckB.current),
    []
  )
  const current = useCallback(() => elementAt(liveRef.current), [elementAt])

  /** Ramps the incoming deck up and the outgoing one down, then parks the loser. */
  const crossfade = useCallback(
    (from: 0 | 1, to: 0 | 1, seconds: number, targetVolume: number) => {
      const outgoing = elementAt(from)
      const incoming = elementAt(to)
      if (fadeTimer.current) clearInterval(fadeTimer.current)

      const park = (): void => {
        if (outgoing && outgoing !== incoming) {
          outgoing.pause()
          outgoing.removeAttribute('src')
          outgoing.load()
          outgoing.volume = targetVolume
        }
      }

      if (seconds <= 0 || !outgoing || outgoing === incoming) {
        if (incoming) incoming.volume = targetVolume
        park()
        return
      }

      const steps = Math.max(1, Math.round((seconds * 1000) / FADE_STEP_MS))
      let step = 0
      if (incoming) incoming.volume = 0
      fadeTimer.current = setInterval(() => {
        step += 1
        const ratio = Math.min(1, step / steps)
        if (incoming) incoming.volume = targetVolume * ratio
        if (outgoing) outgoing.volume = targetVolume * (1 - ratio)
        if (ratio >= 1) {
          if (fadeTimer.current) clearInterval(fadeTimer.current)
          fadeTimer.current = null
          park()
        }
      }, FADE_STEP_MS)
    },
    [elementAt]
  )

  // Load whatever became current onto the idle deck, then fade to it.
  useEffect(() => {
    const from = liveRef.current
    const to: 0 | 1 = from === 0 ? 1 : 0

    if (!s.current) {
      for (const i of [0, 1] as const) {
        const el = elementAt(i)
        if (!el) continue
        el.pause()
        el.removeAttribute('src')
        el.load()
      }
      // Synchronising with an external system (the two audio elements), which
      // is the case the rule explicitly allows; there is no render to derive
      // this from once the source is gone.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPosition(0)
      setDuration(0)
      return
    }

    const track = s.current
    const incoming = elementAt(to)
    if (!incoming) return
    let stale = false

    // Resolve before playing: <audio> only ever reports "source failed", while
    // prepare() names the reason and warms the cache the protocol handler reads.
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
        usePlayer.getState().notePlayed(track.videoId)

        const volume = usePlayer.getState().muted ? 0 : usePlayer.getState().volume
        incoming.src = window.api.streamUrl(track.videoId)
        incoming.volume = 0
        // Rejects with AbortError whenever the next track replaces this src;
        // a genuine failure arrives on the element's error event instead.
        incoming.play().catch(() => {})
        setLive(to)
        liveRef.current = to
        advancing.current = false
        setPosition(0)
        setDuration(0)
        crossfade(from, to, crossfadeSeconds, volume)
      })
      .catch((err: unknown) => {
        if (stale) return
        const p = usePlayer.getState()
        p.toast(`Skipped "${track.title}" — ${err instanceof Error ? err.message : err}`)
        p.next(true)
      })

    return () => {
      stale = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.current])

  useEffect(() => {
    const el = current()
    if (!el || !el.getAttribute('src')) return
    if (s.playing) el.play().catch(() => {})
    else el.pause()
  }, [s.playing, current])

  useEffect(() => {
    const el = current()
    if (!el) return
    // Only the live deck follows the volume control; a deck mid-fade is being
    // driven by the fade and must not be overwritten.
    if (!fadeTimer.current) el.volume = s.muted ? 0 : s.volume
  }, [s.volume, s.muted, current])

  useEffect(
    () => () => {
      if (fadeTimer.current) clearInterval(fadeTimer.current)
    },
    []
  )

  const seek = useCallback(
    (to: number) => {
      const el = current()
      if (el) el.currentTime = to
      setPosition(to)
    },
    [current]
  )

  // Wire the element events for whichever deck is live.
  useEffect(() => {
    const el = current()
    if (!el) return

    const onTime = (): void => {
      setPosition(el.currentTime)
      const p = usePlayer.getState()

      // Start the next track early so the two overlap. Repeat-one is excluded:
      // it has nothing to overlap with.
      const left = el.duration - el.currentTime
      if (
        crossfadeSeconds > 0 &&
        Number.isFinite(left) &&
        left <= crossfadeSeconds &&
        !advancing.current &&
        p.repeat !== 'one' &&
        (p.queue.length > 0 || p.autoplay)
      ) {
        advancing.current = true
        p.next()
      }

      if (p.sleepAt && Date.now() >= p.sleepAt) p.endSleep()
    }
    const onDuration = (): void => setDuration(el.duration)
    const onPlay = (): void => usePlayer.getState().setPlaying(true)
    const onPause = (): void => {
      // A deck parked at the end of a crossfade is not the user pausing.
      if (el === current() && !fadeTimer.current) usePlayer.getState().setPlaying(false)
    }
    const onEnded = (): void => {
      const p = usePlayer.getState()
      if (p.sleepOnTrackEnd) return p.endSleep()
      if (p.repeat === 'one') {
        el.currentTime = 0
        el.play().catch(() => {})
        return
      }
      if (!advancing.current) p.next()
    }
    const onError = (): void => {
      const p = usePlayer.getState()
      if (!p.current) return
      p.toast(`Skipped "${p.current.title}" — playback failed`)
      p.next(true)
    }

    el.addEventListener('timeupdate', onTime)
    el.addEventListener('durationchange', onDuration)
    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)
    el.addEventListener('ended', onEnded)
    el.addEventListener('error', onError)
    return () => {
      el.removeEventListener('timeupdate', onTime)
      el.removeEventListener('durationchange', onDuration)
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
      el.removeEventListener('ended', onEnded)
      el.removeEventListener('error', onError)
    }
  }, [live, crossfadeSeconds, current])

  return { deckA, deckB, live, position, duration, seek, current }
}
