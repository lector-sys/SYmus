import { Construction } from 'lucide-react'
import { Empty } from '../ui'

/** Placeholder until the Settings feature lands. */
export default function Settings(): React.JSX.Element {
  return (
    <div className="view-enter px-6 py-6">
      <Empty icon={Construction} title="Settings" hint="This page is not built yet." />
    </div>
  )
}
