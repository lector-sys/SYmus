import { create } from 'zustand'
import type { Track } from '../../preload'

export type Repeat = 'off' | 'all' | 'one'

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
  queue: Track[]
  history: Track[]
  current: Track | null
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

  playNow: (tracks, index = 0) =>
    set((s) => ({
      current: tracks[index] ?? null,
      queue: tracks.slice(index + 1),
      history: s.current ? remember(s.history, s.current) : s.history,
      playing: tracks.length > 0
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
  | { kind: 'search' }
  | { kind: 'library' }
  | { kind: 'liked' }
  | { kind: 'playlist'; id: number; title: string }
  | { kind: 'genre'; name: string }

interface Nav {
  view: View
  go: (view: View) => void
}

export const useNav = create<Nav>((set) => ({
  view: { kind: 'home' },
  go: (view) => set({ view })
}))
