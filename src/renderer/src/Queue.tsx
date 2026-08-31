import { useState } from 'react'
import { GripVertical, X } from 'lucide-react'
import { fmt, usePlayer } from './store'

export default function Queue(): React.JSX.Element {
  const { queue, current, jumpTo, removeAt, move } = usePlayer()
  const [dragging, setDragging] = useState<number | null>(null)

  return (
    <aside className="flex w-80 flex-col border-l border-zinc-800 bg-zinc-900/40">
      <h2 className="border-b border-zinc-800 px-4 py-3 text-sm font-semibold">Queue</h2>

      {current && (
        <div className="border-b border-zinc-800 px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Now playing</p>
          <p className="mt-1 truncate text-sm text-green-400">{current.title}</p>
        </div>
      )}

      <ol className="flex-1 overflow-y-auto p-2">
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
            onDragEnd={() => setDragging(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              const from = Number(e.dataTransfer.getData('text/plain'))
              if (Number.isInteger(from) && from !== i) move(from, i)
              setDragging(null)
            }}
            className={`group flex items-center gap-2 rounded px-2 py-1.5 hover:bg-zinc-800 ${
              dragging === i ? 'opacity-40' : ''
            }`}
          >
            <GripVertical size={14} className="shrink-0 cursor-grab text-zinc-600" />
            <button onClick={() => jumpTo(i)} className="min-w-0 flex-1 text-left">
              <span className="block truncate text-sm">{t.title}</span>
              <span className="block truncate text-xs text-zinc-500">{t.artist}</span>
            </button>
            <span className="shrink-0 text-xs tabular-nums text-zinc-600">
              {t.duration ? fmt(t.duration) : 'live'}
            </span>
            <button
              onClick={() => removeAt(i)}
              title="Remove"
              className="shrink-0 text-zinc-600 opacity-0 hover:text-zinc-200 group-hover:opacity-100"
            >
              <X size={14} />
            </button>
          </li>
        ))}
        {!queue.length && <li className="px-2 py-3 text-sm text-zinc-600">Nothing queued</li>}
      </ol>
    </aside>
  )
}
