import { useState } from 'react'
import { Heart, ListMusic, Pencil, Play, Shuffle, Tag, Trash2 } from 'lucide-react'
import type { SavedTrack } from '../../preload'
import { usePlayer, useNav } from './store'
import { useLibrary } from './useLibrary'
import TrackRow from './TrackRow'
import { Artwork, Empty, Eyebrow, PageTitle, RowSkeletons } from './ui'

/** Play / shuffle header shared by every track-list page. */
function ListHeader({
  title,
  subtitle,
  tracks,
  art
}: {
  title: string
  subtitle: string
  tracks: SavedTrack[]
  art?: React.ReactNode
}): React.JSX.Element {
  const { playNow, toggleShuffle, shuffle } = usePlayer()
  return (
    <div className="mb-6 flex items-end gap-5">
      {art}
      <div className="flex-1">
        <PageTitle sub={subtitle}>{title}</PageTitle>
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
  )
}

function TrackListPage({
  title,
  subtitle,
  load,
  onRemove,
  empty,
  art,
  cacheKey
}: {
  title: string
  subtitle?: (tracks: SavedTrack[]) => string
  load: () => Promise<SavedTrack[]>
  onRemove?: (t: SavedTrack) => void
  empty: React.ReactNode
  art?: React.ReactNode
  cacheKey: string
}): React.JSX.Element {
  const { data: tracks, loading } = useLibrary(load, [], [cacheKey])

  return (
    <div className="view-enter px-6 py-6">
      <ListHeader
        title={title}
        subtitle={subtitle ? subtitle(tracks) : `${tracks.length} tracks`}
        tracks={tracks}
        art={art}
      />
      {loading ? (
        <RowSkeletons />
      ) : tracks.length ? (
        tracks.map((t, i) => (
          <TrackRow
            key={t.videoId}
            track={t}
            list={tracks}
            index={i}
            showGenre
            onRemove={onRemove && (() => onRemove(t))}
          />
        ))
      ) : (
        empty
      )}
    </div>
  )
}

/** The liked-songs cover: the app's mark rendered as a gradient tile. */
function LikedTile({ size = 'h-28 w-28' }: { size?: string }): React.JSX.Element {
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-flare via-ember to-[#c0392b] ${size}`}
    >
      <Heart size={32} className="text-ink" fill="currentColor" />
    </div>
  )
}

export function LikedView(): React.JSX.Element {
  return (
    <TrackListPage
      cacheKey="liked"
      title="Liked Songs"
      load={() => window.api.lib.likes()}
      art={<LikedTile />}
      empty={
        <Empty
          icon={Heart}
          title="No liked songs yet"
          hint="Tap the heart on any track and it lands here."
        />
      }
    />
  )
}

export function GenreView({ name }: { name: string }): React.JSX.Element {
  return (
    <TrackListPage
      cacheKey={`genre:${name}`}
      title={name}
      load={() => window.api.lib.byGenre(name, 200)}
      empty={
        <Empty
          icon={Tag}
          title={`Nothing tagged ${name}`}
          hint="Tag a track with this genre from the tag button on any library row."
        />
      }
    />
  )
}

export function ArtistView({ name }: { name: string }): React.JSX.Element {
  return (
    <TrackListPage
      cacheKey={`artist:${name}`}
      title={name}
      load={() => window.api.lib.byArtist(name, 100)}
      empty={
        <Empty
          icon={Tag}
          title={`Nothing by ${name}`}
          hint="Search for this artist to pull their tracks into your library."
        />
      }
    />
  )
}

export function PlaylistView({ id, title }: { id: number; title: string }): React.JSX.Element {
  const { libraryChanged, toast } = usePlayer()
  return (
    <TrackListPage
      cacheKey={`playlist:${id}`}
      title={title}
      load={() => window.api.lib.playlistTracks(id)}
      empty={
        <Empty
          icon={ListMusic}
          title="This playlist is empty"
          hint="Search for a track, then use the + button on its row to add it here."
        />
      }
      onRemove={(t) => {
        window.api.lib
          .playlistRemove(id, t.videoId)
          .then(libraryChanged)
          .catch((err) => toast(err instanceof Error ? err.message : String(err)))
      }}
    />
  )
}

export function LibraryView(): React.JSX.Element {
  const { data: playlists, loading } = useLibrary(() => window.api.lib.playlists(), [])
  const { data: liked } = useLibrary(() => window.api.lib.likes(), [])
  const { libraryChanged, toast, playNow } = usePlayer()
  const go = useNav((s) => s.go)
  const [newTitle, setNewTitle] = useState('')
  const [renaming, setRenaming] = useState<{ id: number; title: string } | null>(null)

  const guard = (p: Promise<unknown>): void => {
    p.then(libraryChanged).catch((err) => toast(err instanceof Error ? err.message : String(err)))
  }

  return (
    <div className="view-enter px-6 py-6">
      <div className="mb-6">
        <PageTitle sub={`${playlists.length} playlists · ${liked.length} liked`}>
          Your Library
        </PageTitle>
      </div>

      <button
        onClick={() => go({ kind: 'liked' })}
        className="mb-8 flex w-full items-center gap-4 rounded-xl bg-panel p-3 text-left transition-colors duration-200 hover:bg-raised"
      >
        <LikedTile size="h-16 w-16" />
        <div>
          <p className="text-[15px] font-semibold">Liked Songs</p>
          <p className="mt-0.5 font-mono text-xs text-ash">{liked.length} tracks</p>
        </div>
      </button>

      <Eyebrow>Playlists</Eyebrow>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          const title = newTitle.trim()
          if (!title) return
          guard(window.api.lib.playlistCreate(title))
          setNewTitle('')
        }}
        className="mb-3 flex gap-2"
      >
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="Name a new playlist"
          className="flex-1 rounded-lg border border-line bg-panel px-3.5 py-2.5 text-[13px] outline-none transition-colors placeholder:text-dust focus:border-dust"
        />
        <button
          type="submit"
          className="rounded-lg bg-lifted px-5 text-[13px] font-medium transition-colors hover:bg-line"
        >
          Create
        </button>
      </form>

      {loading && <RowSkeletons count={4} />}

      {playlists.map((p) => (
        <div
          key={p.id}
          className="group flex items-center gap-3 rounded-lg p-2 transition-colors duration-150 hover:bg-panel"
        >
          <Artwork
            src={p.coverUrl}
            size="md"
            rounded="rounded-lg"
            onPlay={() => window.api.lib.playlistTracks(p.id).then((t) => t.length && playNow(t))}
          />

          {renaming?.id === p.id ? (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (renaming.title.trim()) {
                  guard(window.api.lib.playlistRename(p.id, renaming.title.trim()))
                }
                setRenaming(null)
              }}
              className="flex-1"
            >
              <input
                autoFocus
                value={renaming.title}
                onChange={(e) => setRenaming({ id: p.id, title: e.target.value })}
                onBlur={() => setRenaming(null)}
                className="w-full rounded-md bg-lifted px-2 py-1 text-[13px] outline-none"
              />
            </form>
          ) : (
            <button
              onClick={() => go({ kind: 'playlist', id: p.id, title: p.title })}
              className="min-w-0 flex-1 text-left"
            >
              <span className="block truncate text-[13px] font-medium">{p.title}</span>
              <span className="mt-0.5 block truncate font-mono text-xs text-ash">
                {p.count} tracks{p.genre ? ` · ${p.genre}` : ''}
              </span>
            </button>
          )}

          <button
            onClick={() => setRenaming({ id: p.id, title: p.title })}
            title="Rename playlist"
            className="text-ash opacity-0 transition-colors hover:text-chalk group-hover:opacity-100"
          >
            <Pencil size={15} />
          </button>
          <button
            onClick={() => guard(window.api.lib.playlistDelete(p.id))}
            title="Delete playlist"
            className="mr-2 text-ash opacity-0 transition-colors hover:text-chalk group-hover:opacity-100"
          >
            <Trash2 size={15} />
          </button>
        </div>
      ))}

      {!loading && !playlists.length && (
        <Empty
          icon={ListMusic}
          title="No playlists yet"
          hint="Name one above, or paste a YouTube playlist link into Search to pull the whole thing in."
        />
      )}
    </div>
  )
}
