import { useEffect, useRef, useState } from 'react'
import {
  Check,
  Heart,
  Infinity as InfinityIcon,
  ListEnd,
  ListPlus,
  Plus,
  Tag,
  ThumbsDown,
  Trash2
} from 'lucide-react'
import type { SavedTrack, Track } from '../../preload'
import { fmt, usePlayer } from './store'
import { GENRE_CHOICES } from './genres'
import { Artwork, Card, Equalizer } from './ui'

/** Closes a popover on outside click and on Escape. */
function useDismiss(open: boolean, close: () => void): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close])
  return ref
}

const menu =
  'absolute right-0 bottom-full z-30 mb-2 rounded-lg border border-line bg-panel p-1 shadow-2xl shadow-ink/60'
const item = 'block w-full truncate rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-lifted'

function AddToPlaylist({ track }: { track: Track }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [lists, setLists] = useState<{ id: number; title: string }[]>([])
  const [creating, setCreating] = useState('')
  const { toast, libraryChanged } = usePlayer()
  const ref = useDismiss(open, () => setOpen(false))

  // Fetched on open, not on mount: a list of 200 rows must not fire 200 queries.
  useEffect(() => {
    if (open)
      window.api.lib
        .playlists()
        .then(setLists)
        .catch(() => setLists([]))
  }, [open])

  async function add(id: number, title: string): Promise<void> {
    try {
      const added = await window.api.lib.playlistAdd(id, [track])
      toast(added ? `Added to ${title}` : `Already in ${title}`)
      libraryChanged()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err))
    }
    setOpen(false)
  }

  async function create(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    const title = creating.trim()
    if (!title) return
    try {
      await window.api.lib.playlistCreate(title, [track])
      toast(`Created ${title}`)
      libraryChanged()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err))
    }
    setCreating('')
    setOpen(false)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Add to playlist"
        className="text-ash transition-colors hover:text-chalk"
      >
        <Plus size={16} />
      </button>
      {open && (
        <div className={`${menu} w-56`}>
          <div className="max-h-52 overflow-y-auto">
            {lists.map((p) => (
              <button key={p.id} onClick={() => add(p.id, p.title)} className={item}>
                {p.title}
              </button>
            ))}
            {!lists.length && <p className="px-2.5 py-1.5 text-xs text-dust">No playlists yet</p>}
          </div>
          <form onSubmit={create} className="mt-1 flex gap-1 border-t border-line pt-1">
            <input
              value={creating}
              onChange={(e) => setCreating(e.target.value)}
              placeholder="New playlist"
              className="min-w-0 flex-1 rounded-md bg-lifted px-2 py-1.5 text-[13px] outline-none placeholder:text-dust"
            />
            <button
              type="submit"
              aria-label="Create playlist"
              className="rounded-md px-2 text-ash hover:text-chalk"
            >
              <Check size={14} />
            </button>
          </form>
        </div>
      )}
    </div>
  )
}

function GenreTag({ track }: { track: SavedTrack }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const { libraryChanged, toast } = usePlayer()
  const ref = useDismiss(open, () => setOpen(false))

  async function set(genre: string | null): Promise<void> {
    try {
      const alsoTagged = await window.api.lib.setGenre(track.videoId, genre)
      // Tagging one track tags the artist's other untagged tracks. Say so, or
      // the library quietly changing underneath is unsettling.
      if (alsoTagged) {
        toast(`Tagged ${genre} — and ${alsoTagged} more by ${track.artist ?? 'this artist'}`)
      }
      libraryChanged()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err))
    }
    setOpen(false)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        title={track.genre ? `Genre: ${track.genre}` : 'Set genre'}
        className="flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-[11px] text-ash transition-colors hover:border-dust hover:text-chalk"
      >
        <Tag size={11} />
        {track.genre ?? 'Tag'}
      </button>
      {open && (
        <div className={`${menu} max-h-64 w-44 overflow-y-auto`}>
          {track.genre && (
            <button
              onClick={() => set(null)}
              className={`${item} flex items-center gap-2 text-ash`}
            >
              <Trash2 size={12} /> Clear genre
            </button>
          )}
          {GENRE_CHOICES.map((g) => (
            <button
              key={g}
              onClick={() => set(g)}
              className={`${item} ${track.genre === g ? 'text-ember' : ''}`}
            >
              {g}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Right-click menu. Every track action in one place, on every list in the app —
 * the hover icons only have room for the common few.
 *
 * Positioned fixed at the cursor and clamped to the viewport, so a row near the
 * bottom edge does not open a menu off-screen.
 */
function ContextMenu({
  at,
  track,
  onClose,
  onRemove
}: {
  at: { x: number; y: number }
  track: SavedTrack | Track
  onClose: () => void
  onRemove?: () => void
}): React.JSX.Element {
  const ref = useDismiss(true, onClose)
  const { playNext, addToQueue, startRadio, liked, disliked, toggleLike, toggleDislike, filling } =
    usePlayer()
  const isLiked = liked.has(track.videoId)
  const isDisliked = disliked.has(track.videoId)

  const [pos, setPos] = useState(at)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const box = el.getBoundingClientRect()
    setPos({
      x: Math.min(at.x, window.innerWidth - box.width - 8),
      y: Math.min(at.y, window.innerHeight - box.height - 8)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const run = (fn: () => void) => () => {
    fn()
    onClose()
  }

  const row = 'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px]'

  return (
    <div
      ref={ref}
      style={{ left: pos.x, top: pos.y }}
      className="fixed z-50 w-56 rounded-lg border border-line bg-panel p-1 shadow-2xl shadow-ink/70"
    >
      <button onClick={run(() => playNext([track]))} className={`${row} hover:bg-lifted`}>
        <ListPlus size={14} className="text-ash" /> Play next
      </button>
      <button onClick={run(() => addToQueue([track]))} className={`${row} hover:bg-lifted`}>
        <ListEnd size={14} className="text-ash" /> Add to queue
      </button>
      <button
        onClick={run(() => void startRadio(track))}
        disabled={filling}
        className={`${row} hover:bg-lifted disabled:opacity-40`}
      >
        <InfinityIcon size={14} className="text-ash" /> Start radio
      </button>

      <div className="my-1 h-px bg-line" />

      <button onClick={run(() => void toggleLike(track))} className={`${row} hover:bg-lifted`}>
        <Heart size={14} className={isLiked ? 'text-ember' : 'text-ash'} />
        {isLiked ? 'Remove from liked songs' : 'Add to liked songs'}
      </button>
      <button onClick={run(() => void toggleDislike(track))} className={`${row} hover:bg-lifted`}>
        <ThumbsDown size={14} className={isDisliked ? 'text-ember' : 'text-ash'} />
        {isDisliked ? 'Undo not interested' : 'Not interested'}
      </button>

      {onRemove && (
        <>
          <div className="my-1 h-px bg-line" />
          <button onClick={run(onRemove)} className={`${row} hover:bg-lifted`}>
            <Trash2 size={14} className="text-ash" /> Remove from this playlist
          </button>
        </>
      )}
    </div>
  )
}

/**
 * A shelf card for a track, carrying the same right-click menu as a track row —
 * play next / add to queue / radio / like have to be reachable from Home and
 * Explore too, not only from the list views.
 */
export function TrackCard({
  track,
  list,
  index,
  subtitle
}: {
  track: SavedTrack | Track
  list: (SavedTrack | Track)[]
  index: number
  subtitle?: string
}): React.JSX.Element {
  const { playNow, current } = usePlayer()
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)

  return (
    // The wrapper only carries the handler; ContextMenu positions itself fixed.
    // shrink-0 because it replaces Card as the shelf's flex item.
    <div
      className="shrink-0"
      onContextMenu={(e) => {
        e.preventDefault()
        setMenuAt({ x: e.clientX, y: e.clientY })
      }}
    >
      {menuAt && <ContextMenu at={menuAt} track={track} onClose={() => setMenuAt(null)} />}
      <Card
        art={track.thumbnailUrl}
        title={track.title}
        subtitle={subtitle ?? track.artist ?? 'Unknown artist'}
        playing={current?.videoId === track.videoId}
        onOpen={() => playNow(list, index)}
        onPlay={() => playNow(list, index)}
      />
    </div>
  )
}

interface Props {
  track: SavedTrack | Track
  /** Playing this row plays the whole list from here, so the queue keeps its context. */
  list: (SavedTrack | Track)[]
  index: number
  /** Shown on library views, where a track has a genre worth editing. */
  showGenre?: boolean
  /** Present on a playlist page: removes the track from that playlist. */
  onRemove?: () => void
}

export default function TrackRow({
  track,
  list,
  index,
  showGenre,
  onRemove
}: Props): React.JSX.Element {
  const { playNow, playNext, addToQueue, current, playing, liked, disliked, toggleLike } =
    usePlayer()
  const isCurrent = current?.videoId === track.videoId
  const isLiked = liked.has(track.videoId)
  const isDisliked = disliked.has(track.videoId)
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)

  const action = 'text-ash opacity-0 transition-colors hover:text-chalk group-hover:opacity-100'

  return (
    <div
      onContextMenu={(e) => {
        e.preventDefault()
        setMenuAt({ x: e.clientX, y: e.clientY })
      }}
      className={`group relative flex items-center gap-3 rounded-lg py-2 pr-3 pl-4 transition-colors duration-150 ${
        isCurrent ? 'bg-ember/[0.07]' : 'hover:bg-panel'
      } ${isDisliked ? 'opacity-45' : ''}`}
    >
      {menuAt && (
        <ContextMenu
          at={menuAt}
          track={track}
          onRemove={onRemove}
          onClose={() => setMenuAt(null)}
        />
      )}
      {/* The lit edge. Only the playing row gets it. */}
      {isCurrent && (
        <span
          aria-hidden
          className="absolute top-2 bottom-2 left-0 w-[3px] rounded-full bg-ember"
        />
      )}

      {/* The index column becomes the equalizer while this row is the one playing. */}
      <span className="flex w-5 shrink-0 justify-center font-mono text-[11px] text-dust">
        {isCurrent ? <Equalizer playing={playing} /> : index + 1}
      </span>

      <Artwork
        src={track.thumbnailUrl}
        size="sm"
        rounded="rounded-md"
        onPlay={() => playNow(list, index)}
      />

      <button onClick={() => playNow(list, index)} className="min-w-0 flex-1 text-left">
        <span className={`block truncate text-[13px] font-medium ${isCurrent ? 'text-ember' : ''}`}>
          {track.title}
        </span>
        <span className="block truncate text-xs text-ash">{track.artist ?? 'Unknown artist'}</span>
      </button>

      {showGenre && 'genre' in track && (
        <div className="hidden shrink-0 lg:block">
          <GenreTag track={track as SavedTrack} />
        </div>
      )}

      <button
        onClick={() => toggleLike(track)}
        title={isLiked ? 'Remove from liked songs' : 'Add to liked songs'}
        className={isLiked ? 'text-ember transition-colors hover:text-flare' : action}
      >
        <Heart size={15} fill={isLiked ? 'currentColor' : 'none'} />
      </button>
      <button onClick={() => playNext([track])} title="Play next" className={action}>
        <ListPlus size={15} />
      </button>
      <button onClick={() => addToQueue([track])} title="Add to queue" className={action}>
        <ListEnd size={15} />
      </button>
      <div className="opacity-0 transition-opacity group-hover:opacity-100">
        <AddToPlaylist track={track} />
      </div>
      {onRemove && (
        <button onClick={onRemove} title="Remove from this playlist" className={action}>
          <Trash2 size={15} />
        </button>
      )}
      <span className="w-11 shrink-0 text-right font-mono text-[11px] tabular-nums text-ash">
        {track.duration ? fmt(track.duration) : 'LIVE'}
      </span>
    </div>
  )
}
