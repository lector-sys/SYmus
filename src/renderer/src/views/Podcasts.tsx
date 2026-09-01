import { useEffect, useState } from 'react'
import { Mic, Plus, X } from 'lucide-react'
import type { Track } from '../../../preload'
import type { PodcastResult } from '../../../preload/features/podcasts'
import { TrackCard } from '../TrackRow'
import { usePlayer } from '../store'
import { CardSkeletons, Empty, Eyebrow, Shelf } from '../ui'

type Channel = { channelId: string; name: string }

function Row({ title, tracks }: { title: string; tracks?: Track[] }): React.JSX.Element | null {
  // Loaded and empty renders nothing, the same rule the explore shelves follow:
  // an empty row reads as broken.
  if (tracks && !tracks.length) return null
  return (
    <section className="mb-9">
      <Eyebrow>{title}</Eyebrow>
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

/** One followed channel's recent uploads. Fetched per channel, queued in main. */
function ChannelRow({
  channel,
  onUnfollow
}: {
  channel: Channel
  onUnfollow: () => void
}): React.JSX.Element {
  const [tracks, setTracks] = useState<Track[] | undefined>(undefined)

  useEffect(() => {
    let stale = false
    window.api.podcasts
      .channel(channel.channelId)
      .then((found) => {
        if (!stale) setTracks(found)
      })
      .catch(() => {
        if (!stale) setTracks([])
      })
    return () => {
      stale = true
    }
  }, [channel.channelId])

  return (
    <section className="mb-9">
      <div className="flex items-center gap-3">
        <Eyebrow>{channel.name}</Eyebrow>
        <button
          onClick={onUnfollow}
          title={`Unfollow ${channel.name}`}
          className="mb-3 flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-[11px] text-ash transition-colors hover:border-dust hover:text-chalk"
        >
          <X size={11} /> Unfollow
        </button>
      </div>
      {!tracks ? (
        <CardSkeletons />
      ) : tracks.length ? (
        <Shelf>
          {tracks.map((t, i) => (
            <TrackCard key={t.videoId} track={t} list={tracks} index={i} />
          ))}
        </Shelf>
      ) : (
        <p className="text-xs text-ash">Nothing recent from this channel.</p>
      )}
    </section>
  )
}

/**
 * The Podcasts tab.
 *
 * Talk uploads found by searching YouTube — there is no podcast directory here
 * and no API that could provide one, so the discovery row names the query it
 * ran. Following a channel is what turns it into something personal: a followed
 * channel gets its own row of recent uploads, which is a real feed rather than
 * a search.
 */
export default function Podcasts(): React.JSX.Element {
  const { toast } = usePlayer()
  const [found, setFound] = useState<PodcastResult | null>(null)
  const [failed, setFailed] = useState(false)
  const [followed, setFollowed] = useState<Channel[]>([])

  useEffect(() => {
    let stale = false
    window.api.podcasts
      .following()
      .then((list) => {
        if (!stale) setFollowed(list)
      })
      .catch(() => {
        /* an unreadable follow list is not worth a toast on page open */
      })
    window.api.podcasts
      .discover()
      .then((result) => {
        if (!stale) setFound(result)
      })
      .catch(() => {
        if (!stale) setFailed(true)
      })
    return () => {
      stale = true
    }
  }, [])

  async function follow(channel: Channel): Promise<void> {
    try {
      await window.api.podcasts.follow(channel.channelId, channel.name)
      setFollowed(await window.api.podcasts.following())
      toast(`Following ${channel.name}`)
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err))
    }
  }

  async function unfollow(channel: Channel): Promise<void> {
    try {
      await window.api.podcasts.unfollow(channel.channelId)
      setFollowed(await window.api.podcasts.following())
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err))
    }
  }

  const isFollowed = (id: string): boolean => followed.some((c) => c.channelId === id)
  const offer = (found?.channels ?? []).filter((c) => !isFollowed(c.channelId))

  return (
    <>
      {followed.map((channel) => (
        <ChannelRow
          key={channel.channelId}
          channel={channel}
          onUnfollow={() => void unfollow(channel)}
        />
      ))}

      {failed ? (
        <Empty
          icon={Mic}
          title="Could not reach YouTube"
          hint="The search for talk uploads failed. Check your connection and open this tab again."
        />
      ) : (
        <Row
          title={
            found ? `Talk and interviews — searched for “${found.query}”` : 'Talk and interviews'
          }
          tracks={found?.tracks}
        />
      )}

      {offer.length > 0 && (
        <section className="mb-9">
          <Eyebrow>Follow a channel</Eyebrow>
          <div className="flex flex-wrap gap-2">
            {offer.map((channel) => (
              <button
                key={channel.channelId}
                onClick={() => void follow(channel)}
                className="group flex max-w-xs items-center gap-2.5 rounded-full border border-line bg-panel py-2 pr-4 pl-3 text-[13px] transition-colors duration-150 hover:border-dust hover:bg-raised"
              >
                <Plus size={13} className="shrink-0 text-dust group-hover:text-ember" />
                <span className="truncate">{channel.name}</span>
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-ash">
            A followed channel gets its own row of recent uploads at the top of this tab.
          </p>
        </section>
      )}
    </>
  )
}
