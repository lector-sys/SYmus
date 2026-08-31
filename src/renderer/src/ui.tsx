import { useRef, useState, useEffect } from 'react'
import { ChevronLeft, ChevronRight, Music, Play } from 'lucide-react'

/**
 * The app icon's three bars, animating while playback runs and frozen flat when
 * it does not. This is the only "now playing" marker in lists — it says both
 * *which* track and *whether* it is moving, which a coloured row cannot.
 */
export function Equalizer({ playing = true }: { playing?: boolean }): React.JSX.Element {
  return (
    <span aria-hidden className="flex h-4 items-end gap-[3px]">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-[3px] origin-bottom rounded-full bg-ember"
          style={{
            height: '100%',
            // Prime-ish offsets so the three bars never fall back into step.
            animation: playing
              ? `eq ${[900, 620, 780][i]}ms ease-in-out ${i * 130}ms infinite`
              : undefined,
            transform: playing ? undefined : 'scaleY(0.25)'
          }}
        />
      ))}
    </span>
  )
}

/** Section label. Wide-tracked uppercase with an ember tick — a console channel strip. */
export function Eyebrow({
  children,
  action
}: {
  children: React.ReactNode
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="mb-3 flex items-baseline gap-3">
      <span className="h-3 w-[3px] shrink-0 translate-y-[1px] rounded-full bg-ember" />
      <h2 className="eyebrow">{children}</h2>
      <span className="h-px flex-1 bg-line" />
      {action}
    </div>
  )
}

/** Page title. The one place type gets loud. */
export function PageTitle({
  children,
  sub
}: {
  children: React.ReactNode
  sub?: React.ReactNode
}): React.JSX.Element {
  return (
    <div>
      <h1 className="text-[28px] font-bold leading-tight tracking-[-0.02em]">{children}</h1>
      {sub && <p className="mt-1 font-mono text-xs text-ash">{sub}</p>}
    </div>
  )
}

/** Artwork with a play overlay that rises on hover. Falls back to a note glyph. */
export function Artwork({
  src,
  size = 'md',
  rounded = 'rounded-lg',
  onPlay,
  playing
}: {
  src?: string | null
  size?: 'sm' | 'md' | 'lg'
  rounded?: string
  onPlay?: () => void
  playing?: boolean
}): React.JSX.Element {
  const box = { sm: 'h-10 w-10', md: 'h-14 w-14', lg: 'h-full w-full aspect-square' }[size]
  return (
    <div className={`group/art relative shrink-0 overflow-hidden bg-raised ${box} ${rounded}`}>
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover/art:scale-105"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <Music size={18} className="text-dust" />
        </div>
      )}
      {onPlay && (
        <button
          onClick={onPlay}
          aria-label="Play"
          className="absolute inset-0 flex items-center justify-center bg-ink/55 opacity-0 transition-opacity duration-200 group-hover/art:opacity-100 focus-visible:opacity-100"
        >
          <span className="flex h-9 w-9 translate-y-2 items-center justify-center rounded-full bg-ember text-ink shadow-lg shadow-ember/25 transition-transform duration-200 ease-[cubic-bezier(.22,1,.36,1)] group-hover/art:translate-y-0">
            <Play size={15} fill="currentColor" className="ml-[2px]" />
          </span>
        </button>
      )}
      {playing && (
        <div className="absolute inset-x-0 bottom-0 flex h-6 items-end justify-center bg-gradient-to-t from-ink/85 to-transparent pb-1">
          <Equalizer />
        </div>
      )}
    </div>
  )
}

/**
 * A horizontally scrolling shelf of cards. The arrows only appear when there is
 * somewhere to scroll — a disabled arrow on a short row is noise.
 */
export function Shelf({ children }: { children: React.ReactNode }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [edge, setEdge] = useState({ start: false, end: false })

  const measure = (): void => {
    const el = ref.current
    if (!el) return
    setEdge({
      start: el.scrollLeft > 8,
      end: el.scrollLeft + el.clientWidth < el.scrollWidth - 8
    })
  }

  useEffect(() => {
    measure()
    const el = ref.current
    if (!el) return
    // Content arrives async, so re-measure when the row's size changes.
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [children])

  const nudge = (dir: number): void =>
    ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.8, behavior: 'smooth' })

  const arrow =
    'absolute top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-panel/90 text-chalk backdrop-blur transition hover:bg-lifted'

  return (
    <div className="group/shelf relative">
      {edge.start && (
        <button
          onClick={() => nudge(-1)}
          aria-label="Scroll left"
          className={`${arrow} -left-3 opacity-0 group-hover/shelf:opacity-100`}
        >
          <ChevronLeft size={18} />
        </button>
      )}
      <div ref={ref} onScroll={measure} className="no-scrollbar flex gap-4 overflow-x-auto pb-1">
        {children}
      </div>
      {edge.end && (
        <button
          onClick={() => nudge(1)}
          aria-label="Scroll right"
          className={`${arrow} -right-3 opacity-0 group-hover/shelf:opacity-100`}
        >
          <ChevronRight size={18} />
        </button>
      )}
    </div>
  )
}

/** Card for a shelf: artwork, title, subtitle. */
export function Card({
  art,
  title,
  subtitle,
  playing,
  onOpen,
  onPlay
}: {
  art?: string | null
  title: string
  subtitle?: string
  playing?: boolean
  onOpen: () => void
  onPlay?: () => void
}): React.JSX.Element {
  return (
    <div className="w-40 shrink-0">
      <button onClick={onOpen} className="block w-full text-left">
        <div className="rounded-xl bg-panel p-3 transition-colors duration-200 hover:bg-raised">
          <Artwork src={art} size="lg" onPlay={onPlay} playing={playing} />
          <p
            className={`mt-3 truncate text-[13px] font-medium ${playing ? 'text-ember' : 'text-chalk'}`}
          >
            {title}
          </p>
          {subtitle && <p className="mt-0.5 truncate text-xs text-ash">{subtitle}</p>}
        </div>
      </button>
    </div>
  )
}

/** Skeletons: the shape of what is coming, so a slow query never blanks the page. */
export function CardSkeletons({ count = 6 }: { count?: number }): React.JSX.Element {
  return (
    <div className="flex gap-4 overflow-hidden">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="w-40 shrink-0 rounded-xl bg-panel p-3">
          <div className="shimmer aspect-square w-full rounded-lg" />
          <div className="shimmer mt-3 h-3 w-4/5 rounded" />
          <div className="shimmer mt-2 h-2.5 w-1/2 rounded" />
        </div>
      ))}
    </div>
  )
}

export function RowSkeletons({ count = 8 }: { count?: number }): React.JSX.Element {
  return (
    <div className="space-y-1">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2">
          <div className="shimmer h-10 w-10 shrink-0 rounded-md" />
          <div className="flex-1 space-y-2">
            <div className="shimmer h-3 rounded" style={{ width: `${55 - i * 3}%` }} />
            <div className="shimmer h-2.5 w-1/4 rounded" />
          </div>
          <div className="shimmer h-2.5 w-8 rounded" />
        </div>
      ))}
    </div>
  )
}

/** Empty states are an invitation to act, so each one names the next step. */
export function Empty({
  icon: Icon,
  title,
  hint
}: {
  icon: typeof Music
  title: string
  hint: string
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-20 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-raised">
        <Icon size={20} className="text-dust" />
      </div>
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-xs text-xs leading-relaxed text-ash">{hint}</p>
    </div>
  )
}
