import type { Track } from '../../../preload'

export type Tab = 'songs' | 'videos' | 'playlists' | 'artists'

/**
 * Song or video?
 *
 * YouTube exposes no flag for this — every result is a `/watch` entry — so it
 * is a heuristic over the title and channel, in the order the signals can be
 * trusted:
 *
 *  1. "Artist - Topic" is YouTube's auto-generated music upload. Definitive.
 *  2. An explicit video marker ("Official Video", "Live at…") means video, and
 *     is checked before the audio markers because "Official Video" also
 *     contains no audio keyword to fight with.
 *  3. An explicit audio marker means song.
 *  4. Otherwise: short, and titled "Artist - Title", is the shape of a song.
 *
 * ponytail: a keyword ladder, not a classifier. The Videos tab shows every
 * result regardless, so a wrong guess hides nothing — it only misfiles a row
 * under Songs.
 */
export function isSong(track: Track): boolean {
  if ((track.artist ?? '').trim().endsWith('- Topic')) return true

  const title = track.title.toLowerCase()

  if (
    /\b(official (music )?video|music video|live (at|from|on|in)\b|concert|tour|interview|reaction|behind the scenes|making of|trailer|documentary|tutorial|explained|review)\b/.test(
      title
    )
  ) {
    return false
  }

  if (/\b(official audio|audio|lyrics?|lyric video|visuali[sz]er|full album|topic)\b/.test(title)) {
    return true
  }

  // A song is rarely under a minute or over fifteen, and is usually titled
  // "Artist - Title". Zero duration is a livestream, never a song.
  return track.duration > 45 && track.duration <= 900 && / - |–/.test(track.title)
}

/** Results for a tab. Videos deliberately shows everything, Songs is the subset. */
export function forTab(tracks: Track[], tab: Tab): Track[] {
  if (tab === 'songs') return tracks.filter(isSong)
  if (tab === 'videos') return tracks
  return []
}
