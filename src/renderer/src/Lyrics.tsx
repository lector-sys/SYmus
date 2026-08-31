import { Mic2 } from 'lucide-react'
import { Empty } from './ui'

/**
 * Lyrics panel. Occupies the right-hand column in place of the queue.
 *
 * Placeholder until the lyrics feature lands.
 */
export default function Lyrics(): React.JSX.Element {
  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-line bg-panel">
      <Empty icon={Mic2} title="Lyrics" hint="This panel is not built yet." />
    </aside>
  )
}
