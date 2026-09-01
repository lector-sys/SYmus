import { invoke } from '../invoke'
import type { PodcastResult } from '../../main/features/podcasts'
import type { Track } from '../../main/youtube'

export type { PodcastResult }

/** Renderer-facing API for the Podcasts tab. Owned by that feature alone. */
export const podcastsApi = {
  /**
   * A shelf of talk uploads for today's seed query, or an explicit one. The
   * query comes back with the results because the row has to say where it came
   * from — there is no podcast directory behind this.
   */
  discover: (query?: string) => invoke<PodcastResult>('podcasts:discover', query ?? null),
  following: () => invoke<{ channelId: string; name: string }[]>('podcasts:following'),
  follow: (channelId: string, name: string) => invoke<boolean>('podcasts:follow', channelId, name),
  unfollow: (channelId: string) => invoke<boolean>('podcasts:unfollow', channelId),
  /** Recent uploads from one followed channel. */
  channel: (channelId: string) => invoke<Track[]>('podcasts:channel', channelId)
}
