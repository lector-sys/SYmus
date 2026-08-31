import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { z } from 'zod'
import icon from '../../resources/icon.png?asset'
import { prisma, migrate } from './db'
import { search, resolve, audioUrl } from './youtube'
import { registerStreamScheme, handleStreamProtocol } from './stream'
import * as lib from './library'
import { setupTray, setNowPlaying, beginQuit, isQuitting } from './tray'
import { loadEnv } from './env'
import { detectSource, configured, importPlaylist } from './import'
import { registerSearchHistory } from './features/searchHistory'
import { registerLyrics } from './features/lyrics'
import { registerOffline } from './features/offline'
import { registerExplore } from './features/explore'
import { registerAlbums } from './features/albums'

registerStreamScheme()
// Media keys and queue advances have no user gesture behind them, and Chromium
// would otherwise refuse to start playback.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#09090b',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      // This app lives in the tray with the window hidden. Chromium otherwise
      // throttles a hidden renderer's timers, style recalc and rAF, which stalls
      // the progress bar and delays the queue advancing to the next track.
      backgroundThrottling: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  // Closing the window hides to the tray: a music player that stops when you
  // click X is not one you would leave running. Quit lives in the tray menu.
  mainWindow.on('close', (event) => {
    if (isQuitting()) return
    event.preventDefault()
    mainWindow.hide()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

// Everything crossing the IPC boundary is untrusted until it has been through here.
const Query = z.string().trim().min(1).max(500)
const VideoId = z.string().regex(/^[\w-]{11}$/)
const Id = z.number().int().positive()
const Title = z.string().trim().min(1).max(200)
const Genre = z
  .string()
  .trim()
  .max(60)
  .nullable()
  .catch(null)
  .transform((g) => g || null)
const Limit = z.number().int().min(1).max(200).catch(20)

// A track arriving from the renderer is the renderer's own copy of a search
// result; re-validate rather than trusting it back into the database.
const TrackShape = z.object({
  videoId: VideoId,
  title: z.string().min(1).max(500),
  artist: z.string().max(300).nullable().catch(null),
  thumbnailUrl: z.string().max(2000).catch(''),
  duration: z.number().int().min(0).max(86_400).catch(0)
})
const Tracks = z.array(TrackShape).min(1).max(2000)

async function start(): Promise<void> {
  // Must equal the appId in electron-builder.yml, or Windows treats the running
  // app and its Start Menu shortcut as two different applications: no icon
  // grouping on the taskbar and no jump list.
  electronApp.setAppUserModelId('com.madhusudan.symusplayer')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  const envFile = loadEnv()
  if (envFile) console.log('[env] loaded', envFile)

  await migrate()

  if (process.argv.includes('--smoke')) {
    const { smoke } = await import('./smoke')
    return smoke()
  }

  handleStreamProtocol()

  ipcMain.handle('db:stats', async () => ({
    tracks: await prisma.track.count(),
    playlists: await prisma.playlist.count(),
    likes: await prisma.like.count()
  }))
  ipcMain.handle('yt:search', (_e, query) => search(Query.parse(query)))
  ipcMain.handle('yt:resolve', (_e, input) => resolve(Query.parse(input)))
  // <audio> only ever reports "this source failed". Resolving up front gets the real
  // reason ("age-restricted", "private", ...) and warms the cache the protocol reads.
  ipcMain.handle('yt:prepare', async (_e, videoId) => {
    await audioUrl(VideoId.parse(videoId))
  })

  // Library. Everything here is keyed by videoId or playlist id; the renderer
  // never sees a Track row id.
  ipcMain.handle('lib:save', (_e, tracks, hint) =>
    lib.saveTracks(Tracks.parse(tracks), hint == null ? null : String(hint).slice(0, 200))
  )
  ipcMain.handle('lib:play', (_e, track) => lib.recordPlay(TrackShape.parse(track)))
  ipcMain.handle('lib:like', (_e, track, liked) =>
    lib.setLiked(TrackShape.parse(track), Boolean(liked))
  )
  ipcMain.handle('lib:likes', () => lib.likedTracks())
  ipcMain.handle('lib:recent', (_e, limit) => lib.recentlyPlayed(Limit.parse(limit)))
  ipcMain.handle('lib:top', (_e, limit) => lib.mostPlayed(Limit.parse(limit)))
  ipcMain.handle('lib:recommended', (_e, limit) => lib.recommended(Limit.parse(limit)))

  ipcMain.handle('lib:playlists', () => lib.playlists())
  ipcMain.handle('lib:playlistTracks', (_e, id) => lib.playlistTracks(Id.parse(id)))
  ipcMain.handle('lib:playlistCreate', (_e, title, tracks, genre) =>
    lib.createPlaylist(
      Title.parse(title),
      tracks == null ? [] : Tracks.parse(tracks),
      Genre.parse(genre)
    )
  )
  ipcMain.handle('lib:playlistAdd', (_e, id, tracks) =>
    lib.addToPlaylist(Id.parse(id), Tracks.parse(tracks))
  )
  ipcMain.handle('lib:playlistRemove', (_e, id, videoId) =>
    lib.removeFromPlaylist(Id.parse(id), VideoId.parse(videoId))
  )
  ipcMain.handle('lib:playlistRename', (_e, id, title) =>
    lib.renamePlaylist(Id.parse(id), Title.parse(title))
  )
  ipcMain.handle('lib:playlistDelete', (_e, id) => lib.deletePlaylist(Id.parse(id)))
  ipcMain.handle('lib:playlistGenre', (_e, id, genre) =>
    lib.setPlaylistGenre(Id.parse(id), Genre.parse(genre))
  )

  ipcMain.handle('lib:genres', () => lib.genres())
  ipcMain.handle('lib:byGenre', (_e, genre, limit) =>
    lib.tracksByGenre(z.string().trim().min(1).max(60).parse(genre), Limit.parse(limit))
  )
  ipcMain.handle('lib:setGenre', (_e, videoId, genre) =>
    lib.setGenre(VideoId.parse(videoId), Genre.parse(genre))
  )
  ipcMain.handle('lib:similar', (_e, seed, exclude, limit) =>
    lib.similarTo(
      TrackShape.parse(seed),
      z.array(VideoId).max(500).catch([]).parse(exclude),
      Limit.parse(limit)
    )
  )
  ipcMain.handle('lib:genreCoverage', () => lib.genreCoverage())
  ipcMain.handle('lib:artists', (_e, limit) => lib.topArtists(Limit.parse(limit)))
  ipcMain.handle('lib:byArtist', (_e, artist, limit) =>
    lib.tracksByArtist(z.string().trim().min(1).max(300).parse(artist), Limit.parse(limit))
  )

  // Import. Progress is pushed on a channel rather than returned, because a
  // 200-track Spotify import is minutes of YouTube lookups.
  ipcMain.handle('import:detect', (_e, input) => {
    const source = detectSource(String(input ?? '').slice(0, 2000))
    return source ? { source, configured: configured(source) } : { source: null, configured: false }
  })
  ipcMain.handle('import:run', async (event, input) => {
    const url = z.string().trim().min(1).max(2000).parse(input)
    return importPlaylist(url, (progress) => {
      if (!event.sender.isDestroyed()) event.sender.send('import:progress', progress)
    })
  })

  // Feature slices own their own IPC. Each is the single place that feature
  // touches the main process, so features can be built independently.
  for (const register of [
    registerSearchHistory,
    registerLyrics,
    registerOffline,
    registerExplore,
    registerAlbums
  ]) {
    register(ipcMain)
  }

  const window = createWindow()
  setupTray(window, icon)

  // The tray label and tooltip are the only place the OS shows what is playing,
  // so the renderer pushes every change. `send`, not `invoke`: nothing to answer.
  ipcMain.on('player:state', (_e, next) => {
    setNowPlaying(
      {
        title: next?.title ? String(next.title).slice(0, 200) : null,
        artist: next?.artist ? String(next.artist).slice(0, 200) : null,
        playing: Boolean(next?.playing)
      },
      window
    )
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else window.show()
  })
}

// A failed boot must say why instead of leaving an invisible process behind.
app
  .whenReady()
  .then(start)
  .catch((err) => {
    const detail = String(err?.stack ?? err)
    writeFileSync(join(app.getPath('userData'), 'startup-error.log'), detail)
    dialog.showErrorBox('SYmuS failed to start', detail)
    app.quit()
  })

// The window hides rather than closes, so this only fires on a real quit —
// but keep it so a destroyed window cannot leave the process running headless.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', beginQuit)
