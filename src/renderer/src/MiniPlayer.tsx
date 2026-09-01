import { useEffect, useState } from 'react'
import { Maximize2, Music, Pause, Play, SkipBack, SkipForward, X } from 'lucide-react'
import type { MiniState } from '../../preload'

/**
 * The compact always-on-top window.
 *
 * A separate renderer, so it has no access to the player store. It shows a
 * snapshot pushed from the main window and sends commands back over the same
 * channel the tray and media keys use — the mini player is a remote control,
 * not a second player.
 */
export default function MiniPlayer(): React.JSX.Element {
  const [state, setState] = useState<MiniState>({
    title: null,
    artist: null,
    playing: false,
    thumbnailUrl: null
  })

  useEffect(() => window.api.mini.onState(setState), [])

  const button =
    'flex items-center justify-center rounded-full text-ash transition-colors hover:text-chalk'

  return (
    // The whole strip is the drag handle; controls opt out below, or the window
    // would move instead of the button being pressed.
    <div
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      className="flex h-screen items-center gap-3 bg-ink px-3 select-none"
    >
      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-raised">
        {state.thumbnailUrl ? (
          <img src={state.thumbnailUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Music size={18} className="text-dust" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium">{state.title ?? 'Nothing playing'}</p>
        <p className="truncate text-xs text-ash">{state.artist ?? ''}</p>

        <div
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          className="mt-2 flex items-center gap-1"
        >
          <button
            onClick={() => window.api.mini.command('previous')}
            title="Previous"
            className={`${button} h-7 w-7`}
          >
            <SkipBack size={15} fill="currentColor" />
          </button>
          <button
            onClick={() => window.api.mini.command('playpause')}
            title={state.playing ? 'Pause' : 'Play'}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-chalk text-ink transition-transform hover:scale-105 active:scale-95"
          >
            {state.playing ? (
              <Pause size={15} fill="currentColor" />
            ) : (
              <Play size={15} fill="currentColor" className="ml-[1px]" />
            )}
          </button>
          <button
            onClick={() => window.api.mini.command('next')}
            title="Next"
            className={`${button} h-7 w-7`}
          >
            <SkipForward size={15} fill="currentColor" />
          </button>
        </div>
      </div>

      <div
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        className="flex flex-col gap-1 self-start pt-1"
      >
        <button
          onClick={() => window.api.mini.close()}
          title="Back to the full window"
          className={`${button} h-6 w-6`}
        >
          <Maximize2 size={13} />
        </button>
        <button
          onClick={() => window.api.mini.close()}
          title="Close"
          className={`${button} h-6 w-6`}
        >
          <X size={13} />
        </button>
      </div>
    </div>
  )
}
