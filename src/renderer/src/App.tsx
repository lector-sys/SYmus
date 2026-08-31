import { useEffect, useState } from 'react'

export default function App(): React.JSX.Element {
  const [stats, setStats] = useState<Awaited<ReturnType<typeof window.api.dbStats>> | null>(null)

  useEffect(() => {
    window.api.dbStats().then(setStats)
  }, [])

  return (
    <div className="flex h-screen items-center justify-center bg-zinc-950 text-zinc-100">
      <div className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight">SYmuS</h1>
        <p className="mt-2 text-sm text-zinc-500">
          {stats
            ? `db ok — ${stats.tracks} tracks, ${stats.playlists} playlists, ${stats.likes} likes`
            : 'connecting…'}
        </p>
      </div>
    </div>
  )
}
