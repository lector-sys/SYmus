import { useEffect, useState } from 'react'
import { usePlayer } from './store'

/**
 * Runs an async library read and refetches whenever the library changes.
 *
 * Every library view wants the same three things — data, a loading flag, and a
 * refresh after any write — so they share one hook instead of each keeping its
 * own effect and its own stale-response bug.
 */
export function useLibrary<T>(
  load: () => Promise<T>,
  initial: T,
  deps: unknown[] = []
): { data: T; loading: boolean } {
  const version = usePlayer((s) => s.libraryVersion)
  const [data, setData] = useState<T>(initial)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let stale = false
    // The rule guards against cascading renders from derived state. This is the
    // other case the docs allow: starting a request against an external system,
    // where the flag is what tells the view to show its skeleton.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    load()
      .then((d) => {
        // A slow first request must not overwrite the result of a faster second one.
        if (!stale) setData(d)
      })
      .catch(() => {
        if (!stale) setData(initial)
      })
      .finally(() => {
        if (!stale) setLoading(false)
      })
    return () => {
      stale = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, ...deps])

  return { data, loading }
}
