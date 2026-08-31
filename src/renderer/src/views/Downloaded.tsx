import { Construction } from 'lucide-react'
import { Empty } from '../ui'

/** Placeholder until the Downloaded feature lands. */
export default function Downloaded(): React.JSX.Element {
  return (
    <div className="view-enter px-6 py-6">
      <Empty icon={Construction} title="Downloaded" hint="This page is not built yet." />
    </div>
  )
}
