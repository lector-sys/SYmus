import { useCallback, useEffect, useState } from 'react'
import { Compass, RefreshCw } from 'lucide-react'
import type { Track } from '../../../preload'
import type { ExploreShelf } from '../../../preload/features/explore'
import { TrackCard } from '../TrackRow'
import { CardSkeletons, Empty, Eyebrow, PageTitle, Shelf } from '../ui'
import Moods from './Moods'
import Charts from './Charts'
import Podcasts from './Podcasts'

/** Undefined means still loading; an array means loaded, possibly empty. */
type ShelfState = Record<string, Track[] | undefined>

function ShelfRow({
  shelf,
  tracks
}: {
  shelf: ExploreShelf
  tracks?: Track[]
}): React.JSX.Element | null {
  // Loaded and empty: render nothing. An empty row reads as broken, and a shelf
  // that found nothing has nothing to say.
  if (tracks && !tracks.length) return null

  return (
    <section className="mb-9">
      <Eyebrow>{shelf.title}</Eyebrow>
      {!tracks ? (
        <CardSkeletons />
      ) : (
        <Shelf>
          {tracks.map((t, i) => (
            <TrackCard key={t.videoId} track={t} list={tracks} index={i} />
          ))}
        </Shelf>
      )}
    </section>
  )
}

/**
 * The New releases tab: shelves planned from the library, each filled by its own
 * search.
 *
 * "New" here means recently uploaded and found by searching, which is not a
 * release calendar — the tab says so under its title, and the shelf titles say
 * where they came from.
 */
function NewReleases(): React.JSX.Element {
  const [plan, setPlan] = useState<ExploreShelf[] | null>(null)
  const [rows, setRows] = useState<ShelfState>({})
  const [failed, setFailed] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback((): (() => void) => {
    let stale = false
    setRows({})
    setFailed(false)

    window.api.explore
      .plan()
      .then((shelves) => {
        if (stale) return
        setPlan(shelves)
        // Fired together on purpose: the main process runs them one at a time,
        // so each row appears the moment its own search lands instead of the
        // whole page waiting on the slowest one.
        for (const shelf of shelves) {
          window.api.explore
            .shelf(shelf.query, shelf.hint)
            .then((tracks) => {
              if (!stale) setRows((r) => ({ ...r, [shelf.id]: tracks }))
            })
            .catch(() => {
              // One shelf failing is not the page failing; it just has nothing.
              if (!stale) setRows((r) => ({ ...r, [shelf.id]: [] }))
            })
        }
      })
      .catch(() => {
        if (!stale) setFailed(true)
      })

    return () => {
      stale = true
    }
  }, [])

  // The rule guards against cascading renders from derived state. This is the
  // other case the docs allow: starting requests against an external system,
  // where the cleared rows are what tell the view to show its skeletons.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(load, [load])

  async function refresh(): Promise<void> {
    setRefreshing(true)
    try {
      await window.api.explore.clearCache()
      load()
    } finally {
      setRefreshing(false)
    }
  }

  const done = plan?.every((s) => rows[s.id] !== undefined) ?? false
  const anything = plan?.some((s) => rows[s.id]?.length) ?? false

  return (
    <>
      <div className="mb-6 flex justify-end">
        <button
          onClick={refresh}
          disabled={refreshing}
          title="Fetch these rows again"
          className="flex items-center gap-2 rounded-full border border-line px-4 py-2 text-[13px] font-medium transition-colors hover:border-dust hover:bg-panel disabled:opacity-40"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : undefined} />
          Refresh
        </button>
      </div>

      {failed && (
        <Empty
          icon={Compass}
          title="Could not build Explore"
          hint="Reading the library failed. Try Refresh, or search for something to get started."
        />
      )}

      {!failed &&
        (plan ?? []).map((shelf) => (
          <ShelfRow key={shelf.id} shelf={shelf} tracks={rows[shelf.id]} />
        ))}

      {!failed && plan && done && !anything && (
        <Empty
          icon={Compass}
          title="Nothing came back"
          hint="Every search returned empty. Check your connection, then try Refresh."
        />
      )}
    </>
  )
}

/**
 * The tabs, and what each one promises.
 *
 * The subtitle is part of the tab rather than the page: every tab here is
 * best-effort, but each is best-effort about something different, and a single
 * standing disclaimer would end up describing none of them accurately.
 */
const TABS = [
  {
    id: 'new' as const,
    label: 'New releases',
    sub: 'Based on recent uploads — found by search, not a release calendar',
    panel: () => <NewReleases />
  },
  {
    id: 'charts' as const,
    label: 'Charts',
    sub: 'Your listening — not a global chart',
    panel: () => <Charts />
  },
  {
    id: 'moods' as const,
    label: 'Moods and genres',
    sub: 'Every genre your library uses, plus common ones to start from',
    panel: () => <Moods />
  },
  {
    id: 'podcasts' as const,
    label: 'Podcasts',
    sub: 'Talk uploads found by searching YouTube — not a podcast directory',
    panel: () => <Podcasts />
  }
]

type TabId = (typeof TABS)[number]['id']

export default function Explore(): React.JSX.Element {
  const [active, setActive] = useState<TabId>('new')
  const tab = TABS.find((t) => t.id === active) ?? TABS[0]

  return (
    <div className="view-enter px-6 py-6">
      <PageTitle sub={tab.sub}>Explore</PageTitle>

      <div role="tablist" aria-label="Explore" className="mt-5 mb-6 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={t.id === active}
            onClick={() => setActive(t.id)}
            className={`rounded-full px-4 py-2 text-[13px] font-medium transition-colors ${
              t.id === active
                ? 'bg-ember text-ink'
                : 'border border-line hover:border-dust hover:bg-panel'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab.panel()}
    </div>
  )
}
