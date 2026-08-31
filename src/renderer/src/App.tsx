import { useEffect, useState } from 'react'
import {
  Compass,
  Download,
  HardDriveDownload,
  Heart,
  House,
  Library,
  ListMusic,
  Search,
  Settings as SettingsIcon
} from 'lucide-react'
import { usePlayer, useNav, type View } from './store'
import { useLibrary } from './useLibrary'
import PlayerBar from './PlayerBar'
import Queue from './Queue'
import Home from './Home'
import Import from './Import'
import { LibraryView, LikedView, PlaylistView, GenreView, ArtistView } from './Library'
import { Eyebrow } from './ui'
import SearchView from './Search'
import Lyrics from './Lyrics'
import { Explore, Downloaded, Settings, Album } from './views'

function NavButton({
  to,
  icon: Icon,
  label
}: {
  to: View
  icon: typeof House
  label: string
}): React.JSX.Element {
  const { view, go } = useNav()
  const on = view.kind === to.kind
  return (
    <button
      onClick={() => go(to)}
      aria-current={on ? 'page' : undefined}
      className={`relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors duration-150 ${
        on ? 'bg-raised text-chalk' : 'text-ash hover:bg-panel hover:text-chalk'
      }`}
    >
      {on && (
        <span
          aria-hidden
          className="absolute top-2 bottom-2 left-0 w-[3px] rounded-full bg-ember"
        />
      )}
      <Icon size={17} />
      {label}
    </button>
  )
}

/** The three bars of the app icon, as the wordmark. */
function Wordmark(): React.JSX.Element {
  return (
    <div className="flex items-center gap-2.5 px-3 pt-1 pb-5">
      <span aria-hidden className="flex h-4 items-end gap-[3px]">
        <span className="h-2 w-[3px] rounded-full bg-gradient-to-b from-flare to-ember" />
        <span className="h-4 w-[3px] rounded-full bg-gradient-to-b from-flare to-ember" />
        <span className="h-3 w-[3px] rounded-full bg-gradient-to-b from-flare to-ember" />
      </span>
      <span className="text-[15px] font-bold tracking-[0.06em]">SYmuS</span>
    </div>
  )
}

export default function App(): React.JSX.Element {
  const [queueOpen, setQueueOpen] = useState(true)
  const { toasts, refreshLikes, lyricsOpen } = usePlayer()
  const { view, go } = useNav()
  const { data: playlists } = useLibrary(() => window.api.lib.playlists(), [])

  // The liked set drives the heart on every row, so it is loaded once at boot.
  useEffect(() => {
    refreshLikes().catch(() => {})
  }, [refreshLikes])

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-ink">
      <div className="flex min-h-0 flex-1">
        <nav className="flex w-56 shrink-0 flex-col border-r border-line bg-panel p-3">
          <Wordmark />
          <div className="space-y-0.5">
            <NavButton to={{ kind: 'home' }} icon={House} label="Home" />
            <NavButton to={{ kind: 'search' }} icon={Search} label="Search" />
            <NavButton to={{ kind: 'explore' }} icon={Compass} label="Explore" />
            <NavButton to={{ kind: 'library' }} icon={Library} label="Library" />
            <NavButton to={{ kind: 'downloaded' }} icon={HardDriveDownload} label="Downloaded" />
            <NavButton to={{ kind: 'import' }} icon={Download} label="Import" />
            <NavButton to={{ kind: 'liked' }} icon={Heart} label="Liked Songs" />
          </div>

          <div className="mt-6 min-h-0 flex-1 overflow-y-auto">
            <div className="px-3">
              <Eyebrow>Playlists</Eyebrow>
            </div>
            {playlists.map((p) => {
              const on = view.kind === 'playlist' && view.id === p.id
              return (
                <button
                  key={p.id}
                  onClick={() => go({ kind: 'playlist', id: p.id, title: p.title })}
                  aria-current={on ? 'page' : undefined}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left text-[13px] transition-colors duration-150 ${
                    on ? 'bg-raised text-chalk' : 'text-ash hover:text-chalk'
                  }`}
                >
                  <ListMusic size={14} className="shrink-0" />
                  <span className="truncate">{p.title}</span>
                </button>
              )
            })}
            {!playlists.length && (
              <p className="px-3 text-xs leading-relaxed text-dust">
                Playlists you create show up here.
              </p>
            )}
          </div>

          <div className="mt-2 border-t border-line pt-2">
            <NavButton to={{ kind: 'settings' }} icon={SettingsIcon} label="Settings" />
          </div>
        </nav>

        <main className="min-w-0 flex-1 overflow-y-auto">
          {/* The key remounts the pane on every navigation, which is what
              restarts the enter animation and resets scroll. */}
          <div key={JSON.stringify(view)} className="min-h-full">
            {view.kind === 'home' && <Home />}
            {view.kind === 'search' && <SearchView initial={view.query} />}
            {view.kind === 'import' && <Import />}
            {view.kind === 'library' && <LibraryView />}
            {view.kind === 'liked' && <LikedView />}
            {view.kind === 'playlist' && <PlaylistView id={view.id} title={view.title} />}
            {view.kind === 'genre' && <GenreView name={view.name} />}
            {view.kind === 'artist' && <ArtistView name={view.name} />}
            {view.kind === 'album' && <Album name={view.name} artist={view.artist} />}
            {view.kind === 'explore' && <Explore />}
            {view.kind === 'downloaded' && <Downloaded />}
            {view.kind === 'settings' && <Settings />}
          </div>
        </main>

        {lyricsOpen ? <Lyrics /> : queueOpen && <Queue />}
      </div>

      <PlayerBar onToggleQueue={() => setQueueOpen((v) => !v)} queueOpen={queueOpen} />

      <div className="pointer-events-none fixed bottom-24 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="view-enter rounded-lg border border-line bg-raised px-4 py-2.5 text-[13px] shadow-2xl shadow-ink/70"
          >
            {t.message}
          </div>
        ))}
      </div>
    </div>
  )
}
