import { BrowserWindow, ipcMain, type IpcMain } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'

/**
 * Compact always-on-top player.
 *
 * A second BrowserWindow is a separate renderer with its own store, so it cannot
 * read the main window's state directly. Instead the main window pushes a
 * snapshot on every change and the mini window sends commands back through the
 * same `media` channel the tray and the media keys already use — no third
 * control path to keep in sync.
 */

let mini: BrowserWindow | null = null

/** The last snapshot, replayed to the mini window as soon as it opens. */
let snapshot: unknown = null

export function isMiniOpen(): boolean {
  return Boolean(mini && !mini.isDestroyed())
}

/** Forwards the main window's now-playing snapshot to the mini window. */
export function pushToMini(state: unknown): void {
  snapshot = state
  if (isMiniOpen() && !mini!.webContents.isDestroyed()) {
    mini!.webContents.send('mini:state', state)
  }
}

function create(parent: BrowserWindow, icon: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 340,
    height: 132,
    minWidth: 300,
    minHeight: 120,
    maxHeight: 200,
    show: false,
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#0a0908',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      backgroundThrottling: false
    }
  })

  // `#mini` is what the renderer entry checks to decide which UI to mount.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#mini`)
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'mini' })
  }

  window.once('ready-to-show', () => {
    window.show()
    if (snapshot) window.webContents.send('mini:state', snapshot)
  })
  window.on('closed', () => {
    mini = null
  })

  void parent
  return window
}

/** Opens the mini player, or closes it if it is already open. Returns the new state. */
export function toggleMini(parent: BrowserWindow, icon: string): boolean {
  if (isMiniOpen()) {
    mini!.close()
    mini = null
    parent.show()
    return false
  }
  mini = create(parent, icon)
  // Hiding the main window is the point of a mini player: it is meant to
  // replace the window, not sit on top of it.
  parent.hide()
  return true
}

export function registerMini(main: BrowserWindow, icon: string, api: IpcMain = ipcMain): void {
  api.handle('mini:toggle', () => toggleMini(main, icon))
  api.handle('mini:isOpen', () => isMiniOpen())
  api.handle('mini:close', () => {
    if (isMiniOpen()) toggleMini(main, icon)
    return false
  })
}
