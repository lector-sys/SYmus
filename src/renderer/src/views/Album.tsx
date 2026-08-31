import { Construction } from 'lucide-react'
import { Empty } from '../ui'

/** Placeholder until the Album feature lands. */
export default function Album({
  name,
  artist
}: {
  name: string
  artist: string | null
}): React.JSX.Element {
  void name
  void artist
  return (
    <div className="view-enter px-6 py-6">
      <Empty icon={Construction} title="Album" hint="This page is not built yet." />
    </div>
  )
}
