import { useState } from 'react'
import { GripVertical, Infinity as InfinityIcon, ListVideo, X } from 'lucide-react'
import { fmt, usePlayer } from './store'
import { Artwork, Empty, Equalizer, Eyebrow } from './ui'

export default function Queue(): React.JSX.Element {
  const { queue, current, playing, jumpTo, removeAt, move, radioSeed, filling } = usePlayer()
  const [dragging, setDragging] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-line bg-panel">
      <div className="px-4 pt-4">
        <Eyebrow>{radioSeed ? 'Radio' : 'Queue'}</Eyebrow>
        {radioSeed && (
          <p className="-mt-1 mb-3 flex items-center gap-1.5 text-xs text-ash">
            <InfinityIcon size={12} className="shrink-0 text-ember" />
            {/* truncate needs its own block; on the flex parent it does nothing
                and the seed title runs off the panel. */}
            <span className="min-w-0 truncate">Based on {radioSeed}</span>
          </p>
        )}
      </div>

      {current && (
        <div className="mx-3 mb-2 flex items-center gap-3 rounded-lg bg-ember/[0.07] p-2.5">
          <Artwork src={current.thumbnailUrl} size="sm" rounded="rounded-md" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-ember">{current.title}</p>
            <p className="truncate text-xs text-ash">{current.artist ?? 'Unknown artist'}</p>
          </div>
          <Equalizer playing={playing} />
        </div>
      )}

      <ol className="flex-1 overflow-y-auto px-2 pb-3">
        {queue.map((t, i) => (
          <li
            key={`${t.videoId}-${i}`}
            draggable
            // The source index rides on the drag itself. React state is only for the
            // drag styling — reading it back in onDrop would use a stale closure.
            onDragStart={(e) => {
              e.dataTransfer.setData('text/plain', String(i))
              setDragging(i)
            }}
            onDragEnd={() => {
              setDragging(null)
              setOver(null)
            }}
            onDragOver={(e) => {
              e.preventDefault()
              setOver(i)
            }}
            onDrop={(e) => {
              e.preventDefault()
              const from = Number(e.dataTransfer.getData('text/plain'))
              if (Number.isInteger(from) && from !== i) move(from, i)
              setDragging(null)
              setOver(null)
            }}
            className={`group flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors duration-150 ${
              dragging === i ? 'opacity-30' : 'hover:bg-lifted'
            } ${over === i && dragging !== i ? 'ring-1 ring-ember/40' : ''}`}
          >
            <GripVertical
              size={13}
              className="shrink-0 cursor-grab text-dust opacity-0 group-hover:opacity-100"
            />
            <span className="w-4 shrink-0 text-center font-mono text-[11px] text-dust group-hover:hidden">
              {i + 1}
            </span>
            <button onClick={() => jumpTo(i)} className="min-w-0 flex-1 text-left">
              <span className="block truncate text-[13px]">{t.title}</span>
              <span className="block truncate text-xs text-ash">
                {t.artist ?? 'Unknown artist'}
              </span>
              {t.via && (
                <span className="mt-0.5 block truncate text-[11px] text-ember/80">
                  Because you played {t.via}
                </span>
              )}
            </button>
            <span className="shrink-0 font-mono text-[11px] tabular-nums text-dust">
              {t.duration ? fmt(t.duration) : 'LIVE'}
            </span>
            <button
              onClick={() => removeAt(i)}
              title="Remove from queue"
              className="shrink-0 text-dust opacity-0 transition-colors hover:text-chalk group-hover:opacity-100"
            >
              <X size={13} />
            </button>
          </li>
        ))}
        {!queue.length &&
          (filling ? (
            <p className="flex items-center justify-center gap-2 px-4 py-10 text-xs text-ash">
              <InfinityIcon size={13} className="text-ember" />
              Finding similar tracks…
            </p>
          ) : (
            <Empty
              icon={ListVideo}
              title="Queue is empty"
              hint="Play a track, or use Add to queue on any row to line one up next."
            />
          ))}
      </ol>
    </aside>
  )
}
