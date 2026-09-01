import { Compass } from 'lucide-react'
import type { GenreTile } from '../../../preload/features/explore'
import { useNav } from '../store'
import { useLibrary } from '../useLibrary'
import { Empty } from '../ui'

/**
 * Twelve hues, far enough apart that two tiles never read as the same colour.
 * A tile takes one from a hash of its name, so a genre keeps its colour across
 * launches and a genre invented later still gets one — without a colour column
 * in the database.
 */
const HUES = [8, 28, 45, 72, 96, 132, 162, 190, 214, 250, 286, 322]

function hueIndex(name: string): number {
  let hash = 0
  for (const character of name) hash = (hash * 31 + character.charCodeAt(0)) % 4093
  return hash % HUES.length
}

/**
 * Hues for a whole grid, in order.
 *
 * The hue comes from the name so a genre keeps its colour between launches, but
 * a hash alone puts two purples side by side often enough to read as sloppy
 * rather than deliberate. A tile that collides with either of its two
 * predecessors steps to the next free hue, which is still stable for a given
 * list and never repeats within a row.
 */
function huesFor(names: string[]): number[] {
  const used: number[] = []
  for (const name of names) {
    let index = hueIndex(name)
    const recent = used.slice(-2)
    for (let step = 0; step < HUES.length && recent.includes(HUES[index]); step++) {
      index = (index + 1) % HUES.length
    }
    used.push(HUES[index])
  }
  return used
}

function Tile({ tile, hue }: { tile: GenreTile; hue: number }): React.JSX.Element {
  const go = useNav((s) => s.go)
  return (
    <button
      onClick={() => go({ kind: 'genre', name: tile.genre })}
      // The hue is the tile's; the lightness belongs to the theme, so one pair
      // of CSS rules covers light and dark without this component knowing which
      // is on. See .genre-tile in assets/main.css.
      style={{ '--tile-h': hue } as React.CSSProperties}
      className="genre-tile flex aspect-[5/3] flex-col justify-between overflow-hidden rounded-xl p-3.5 text-left transition-transform duration-150 ease-[cubic-bezier(.22,1,.36,1)] hover:scale-[1.02] active:scale-[0.99]"
    >
      <span className="text-[15px] leading-tight font-semibold">{tile.genre}</span>
      <span className="text-xs opacity-80">
        {tile.count ? `${tile.count} track${tile.count === 1 ? '' : 's'}` : 'Nothing yet'}
      </span>
    </button>
  )
}

/**
 * The moods and genres grid.
 *
 * Genres with nothing behind them are shown on purpose: an empty tile is the
 * entry point to Find more on the genre page, which is how a genre gets its
 * first track. Hiding them would leave the grid unable to grow.
 */
export default function Moods(): React.JSX.Element {
  const { data: tiles, loading } = useLibrary(() => window.api.explore.tiles(), [])
  const hues = huesFor(tiles.map((t) => t.genre))

  if (!loading && !tiles.length) {
    return (
      <Empty
        icon={Compass}
        title="No genres to browse"
        hint="Search for something, then tag a track with the tag button on its row."
      />
    )
  }

  return (
    <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(11rem,1fr))]">
      {loading
        ? // The grid's own shape, so the page does not jump when tiles land.
          Array.from({ length: 12 }, (_, i) => (
            <div key={i} className="shimmer aspect-[5/3] rounded-xl" />
          ))
        : tiles.map((tile, i) => <Tile key={tile.genre} tile={tile} hue={hues[i]} />)}
    </div>
  )
}
