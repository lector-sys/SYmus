import { Construction } from 'lucide-react'
import { Empty } from '../ui'

/** Placeholder until the Explore feature lands. */
export default function Explore(): React.JSX.Element {
  return (
    <div className="view-enter px-6 py-6">
      <Empty icon={Construction} title="Explore" hint="This page is not built yet." />
    </div>
  )
}
