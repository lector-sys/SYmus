import { create } from 'zustand'
import type { Track } from '../../preload'

export type Repeat = 'off' | 'all' | 'one'

/**
 * A queue entry, plus where it came from. `via` is set only on tracks the app
 * queued by itself, so the queue can say "Because you played X" rather than
 * silently growing.
 */
export type QueueTrack = Track & { via?: string }

const AUTOPLAY_KEY = 'symus.autoplay'

/**
 * Autoplay is on unless the user turned it off.
 *
 * Guarded because this module is imported by the node test runner, where there
 * is no localStorage — an unguarded read throws at import time and takes the
 * whole store, and every test that touches it, down with it.
 */
const storedAutoplay = (): boolean => {
  try {
    return globalThis.localStorage?.getItem(AUTOPLAY_KEY) !== 'off'
  } catch {
    return true
  }
}

const rememberAutoplay = (on: boolean): void => {
  try {
    globalThis.localStorage?.setItem(AUTOPLAY_KEY, on ? 'on' : 'off')
  } catch {
    /* no storage here; the setting simply does not persist */
  }
}

const HISTORY_CAP = 50

/** Immutable push with eviction — one song on repeat must not evict the whole history. */
const remember = (history: Track[], track: Track): Track[] =>
  [...history, track].slice(-HISTORY_CAP)

export const fmt = (s: number): string =>
  Number.isFinite(s) && s > 0
    ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
    : '0:00'

interface Toast {
  id: number
  message: string
}

interface Player {
  queue: QueueTrack[]
  history: QueueTrack[]
  current: QueueTrack | null
  playing: boolean
  volume: number
  muted: boolean
  shuffle: boolean
  repeat: Repeat
  toasts: Toast[]

  /** videoIds of liked tracks. A Set so every row can ask in O(1) while rendering. */
  liked: Set<string>
  /** Bumped on every write to the library, so views know to refetch. */
  libraryVersion: number

  /** Keep playing something similar when the queue runs dry. Persisted. */
  autoplay: boolean
  /** Set while an autoplay/radio fetch is in flight, so it cannot fire twice. */
  filling: boolean
  /** videoIds played this session — autoplay must not serve them again. */
  sessionPlayed: Set<string>
  /** What the current autoplay/radio session is seeded from, for the queue header. */
  radioSeed: string | null
  /** Whether the lyrics panel is showing instead of the queue. */
  lyricsOpen: boolean

  playNow: (tracks: Track[], index?: number) => void
  addToQueue: (tracks: Track[]) => void
  playNext: (tracks: Track[]) => void
  removeAt: (index: number) => void
  move: (from: number, to: number) => void
  jumpTo: (index: number) => void
  next: (failed?: boolean) => void
  previous: () => boolean
  setPlaying: (playing: boolean) => void
  setVolume: (volume: number) => void
  toggleMute: () => void
  toggleShuffle: () => void
  cycleRepeat: () => void
  toast: (message: string) => void

  setAutoplay: (on: boolean) => void
  toggleLyrics: () => void
  notePlayed: (videoId: string) => void
  /** Fills an empty queue with similar tracks. No-op unless autoplay applies. */
  autoplayIfIdle: () => Promise<void>
  /** Explicit user action: clear the queue and start an endless session from `seed`. */
  startRadio: (seed: Track, label?: string) => Promise<void>

  refreshLikes: () => Promise<void>
  toggleLike: (track: Track) => Promise<void>
  /** Call after any library mutation made outside the store, so views refetch. */
  libraryChanged: () => void
}

let toastId = 0

export const usePlayer = create<Player>((set, get) => ({
  queue: [],
  history: [],
  current: null,
  playing: false,
  volume: 1,
  muted: false,
  shuffle: false,
  repeat: 'off',
  toasts: [],
  liked: new Set<string>(),
  libraryVersion: 0,
  autoplay: storedAutoplay(),
  filling: false,
  sessionPlayed: new Set<string>(),
  radioSeed: null,
  lyricsOpen: false,

  playNow: (tracks, index = 0) =>
    set((s) => ({
      current: tracks[index] ?? null,
      queue: tracks.slice(index + 1),
      history: s.current ? remember(s.history, s.current) : s.history,
      playing: tracks.length > 0,
      // An explicit choice ends whatever radio was running.
      radioSeed: null
    })),

  addToQueue: (tracks) => set((s) => ({ queue: [...s.queue, ...tracks] })),
  playNext: (tracks) => set((s) => ({ queue: [...tracks, ...s.queue] })),
  removeAt: (index) => set((s) => ({ queue: s.queue.filter((_, i) => i !== index) })),

  move: (from, to) =>
    set((s) => {
      const queue = [...s.queue]
      const [moved] = queue.splice(from, 1)
      if (!moved) return {}
      queue.splice(to, 0, moved)
      return { queue }
    }),

  /**
   * Jump straight to queue[index], consuming everything in between. What was
   * playing goes to history first, then everything jumped over, so Previous
   * walks back through them in the order they appeared.
   */
  jumpTo: (index) =>
    set((s) => {
      if (index < 0 || index >= s.queue.length) return {}
      const queue = [...s.queue]
      const skipped = queue.splice(0, index + 1)
      const current = skipped.pop()!
      let history = s.current ? remember(s.history, s.current) : s.history
      for (const track of skipped) history = remember(history, track)
      return { queue, history, current, playing: true }
    }),

  /**
   * Advance. `failed` marks a track that never played: it goes to history but is
   * never requeued, or repeat-all would loop on a dead video forever.
   *
   * Repeat-one is deliberately not handled here — pressing Next with repeat-one
   * on should move to the next track, not replay. The <audio> ended handler owns it.
   */
  next: (failed = false) =>
    set((s) => {
      const queue = [...s.queue]
      let history = s.history
      if (s.current) {
        history = remember(history, s.current)
        if (s.repeat === 'all' && !failed) queue.push(s.current)
      }
      const at = s.shuffle && queue.length > 1 ? Math.floor(Math.random() * queue.length) : 0
      const [current = null] = queue.splice(at, 1)
      return { queue, history, current, playing: current !== null }
    }),

  /** False means there was nothing to go back to — the caller restarts the current track. */
  previous: () => {
    const s = get()
    const prev = s.history.at(-1)
    if (!prev) return false
    set({
      history: s.history.slice(0, -1),
      queue: s.current ? [s.current, ...s.queue] : s.queue,
      current: prev,
      playing: true
    })
    return true
  },

  setPlaying: (playing) => set({ playing }),
  setVolume: (volume) => set({ volume, muted: false }),
  toggleMute: () => set((s) => ({ muted: !s.muted })),
  toggleShuffle: () => set((s) => ({ shuffle: !s.shuffle })),
  cycleRepeat: () =>
    set((s) => ({ repeat: s.repeat === 'off' ? 'all' : s.repeat === 'all' ? 'one' : 'off' })),

  toast: (message) => {
    const id = ++toastId
    set((s) => ({ toasts: [...s.toasts, { id, message }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 6000)
  },

  libraryChanged: () => set((s) => ({ libraryVersion: s.libraryVersion + 1 })),

  toggleLyrics: () => set((s) => ({ lyricsOpen: !s.lyricsOpen })),

  setAutoplay: (on) => {
    rememberAutoplay(on)
    set({ autoplay: on, ...(on ? {} : { radioSeed: null }) })
  },

  notePlayed: (videoId) =>
    set((s) => {
      if (s.sessionPlayed.has(videoId)) return {}
      return { sessionPlayed: new Set(s.sessionPlayed).add(videoId) }
    }),

  /**
   * Repeat wins outright: with repeat on, an empty queue is not idle, it is
   * about to loop. Autoplay only fills a genuinely finished queue.
   */
  autoplayIfIdle: async () => {
    const s = get()
    if (!s.autoplay || s.filling || s.repeat !== 'off') return
    if (s.current || s.queue.length) return
    const seed = s.history.at(-1)
    if (!seed) return

    set({ filling: true })
    try {
      const similar = await window.api.lib.similar(seed, [...s.sessionPlayed], 10)
      if (!similar.length) {
        get().toast('Autoplay could not find anything similar')
        return
      }
      const via = seed.title
      // Deliberately does not set radioSeed. Passive autoplay is not a radio
      // session: the per-track "Because you played X" line says where these came
      // from, and the panel stays "Queue". "Radio" is reserved for startRadio,
      // which the user asked for explicitly.
      set({
        current: { ...similar[0], via },
        queue: similar.slice(1).map((t) => ({ ...t, via })),
        playing: true
      })
    } catch (err) {
      get().toast(err instanceof Error ? err.message : String(err))
    } finally {
      set({ filling: false })
    }
  },

  startRadio: async (seed, label) => {
    const s = get()
    if (s.filling) return
    set({ filling: true, radioSeed: label ?? seed.title })
    try {
      const similar = await window.api.lib.similar(seed, [...s.sessionPlayed], 20)
      const via = label ?? seed.title
      // The seed itself plays first: "radio from this track" should start with it.
      const rest = similar.filter((t) => t.videoId !== seed.videoId).map((t) => ({ ...t, via }))
      if (!rest.length) {
        get().toast(`Not enough to build a radio from ${via} yet`)
        set({ radioSeed: null })
        return
      }
      set({
        current: seed,
        queue: rest,
        playing: true,
        history: s.current ? remember(s.history, s.current) : s.history
      })
    } catch (err) {
      get().toast(err instanceof Error ? err.message : String(err))
      set({ radioSeed: null })
    } finally {
      set({ filling: false })
    }
  },

  refreshLikes: async () => {
    const likes = await window.api.lib.likes()
    set({ liked: new Set(likes.map((t) => t.videoId)) })
  },

  /**
   * Optimistic: the heart fills immediately and rolls back if the write fails.
   * A round trip before the icon moves makes the whole app feel laggy.
   */
  toggleLike: async (track) => {
    const s = get()
    const next = !s.liked.has(track.videoId)
    const optimistic = new Set(s.liked)
    if (next) optimistic.add(track.videoId)
    else optimistic.delete(track.videoId)
    set({ liked: optimistic })
    try {
      await window.api.lib.like(track, next)
      get().libraryChanged()
    } catch (err) {
      set({ liked: s.liked })
      get().toast(err instanceof Error ? err.message : String(err))
    }
  }
}))

/**
 * Which page the main pane is showing. A four-line union beats a router: this
 * app has no URLs, no deep links and no back button to keep in sync.
 */
export type View =
  | { kind: 'home' }
  /** `query` prefills and runs the search — used by the import's unmatched list. */
  | { kind: 'search'; query?: string }
  | { kind: 'library' }
  | { kind: 'import' }
  | { kind: 'liked' }
  | { kind: 'playlist'; id: number; title: string }
  | { kind: 'genre'; name: string }
  | { kind: 'artist'; name: string }
  | { kind: 'album'; name: string; artist: string | null }
  | { kind: 'explore' }
  | { kind: 'downloaded' }
  | { kind: 'settings' }

interface Nav {
  view: View
  go: (view: View) => void
}

export const useNav = create<Nav>((set) => ({
  view: { kind: 'home' },
  go: (view) => set({ view })
}))
