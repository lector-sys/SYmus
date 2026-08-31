import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { z } from 'zod'
import icon from '../../resources/icon.png?asset'
import { prisma, migrate } from './db'
import { search, resolve, audioUrl } from './youtube'
import { registerStreamScheme, handleStreamProtocol } from './stream'

registerStreamScheme()
// Media keys and queue advances have no user gesture behind them, and Chromium
// would otherwise refuse to start playback.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

function createWindow(): void {
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
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Everything crossing the IPC boundary is untrusted until it has been through here.
const Query = z.string().trim().min(1).max(500)
const VideoId = z.string().regex(/^[\w-]{11}$/)

async function start(): Promise<void> {
  electronApp.setAppUserModelId('com.symus.desktop')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  await migrate()
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

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
