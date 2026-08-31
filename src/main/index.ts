import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { prisma, migrate } from './db'

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

async function start(): Promise<void> {
  electronApp.setAppUserModelId('com.symus.desktop')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  await migrate()

  ipcMain.handle('db:stats', async () => ({
    tracks: await prisma.track.count(),
    playlists: await prisma.playlist.count(),
    likes: await prisma.like.count()
  }))

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

// A failed boot must say why instead of leaving an invisible process behind.
app.whenReady().then(start).catch((err) => {
  const detail = String(err?.stack ?? err)
  writeFileSync(join(app.getPath('userData'), 'startup-error.log'), detail)
  dialog.showErrorBox('SYmuS failed to start', detail)
  app.quit()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
