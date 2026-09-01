import { app, BrowserWindow, globalShortcut, Menu, nativeImage, Tray } from 'electron'

export type MediaCommand = 'playpause' | 'next' | 'previous' | 'stop'

/** What the renderer last told us it was doing. Drives the tray label and tooltip. */
interface NowPlaying {
  title: string | null
  artist: string | null
  playing: boolean
}

let tray: Tray | null = null
let state: NowPlaying = { title: null, artist: null, playing: false }

/**
 * Set just before app.quit() so the window's close handler knows this is a real
 * quit and not a click on the X, which only hides to the tray.
 */
let quitting = false
export const beginQuit = (): void => {
  quitting = true
}
export const isQuitting = (): boolean => quitting

const send = (command: MediaCommand): void => {
  BrowserWindow.getAllWindows()[0]?.webContents.send('media', command)
}

function show(window: BrowserWindow): void {
  // With minimize-to-tray off, closing the window really destroys it while the
  // tray (and its menu, holding this reference) lives on. Every method below
  // throws on a destroyed window.
  if (window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

function render(window: BrowserWindow): void {
  if (!tray) return
  const label = state.title
    ? `${state.title}${state.artist ? ` — ${state.artist}` : ''}`
    : 'Nothing playing'

  tray.setToolTip(`SYmuS\n${label}`)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      // Electron truncates a long tray label anyway; trim it ourselves so it
      // truncates somewhere sensible.
      { label: label.length > 60 ? `${label.slice(0, 57)}…` : label, enabled: false },
      { type: 'separator' },
      {
        label: state.playing ? 'Pause' : 'Play',
        enabled: Boolean(state.title),
        click: () => send('playpause')
      },
      { label: 'Previous', click: () => send('previous') },
      { label: 'Next', click: () => send('next') },
      { type: 'separator' },
      { label: 'Show SYmuS', click: () => show(window) },
      {
        label: 'Quit',
        click: () => {
          beginQuit()
          app.quit()
        }
      }
    ])
  )
}

/** Called by the IPC handler whenever playback changes. */
export function setNowPlaying(next: NowPlaying, window: BrowserWindow): void {
  state = next
  render(window)
}

/**
 * Tray icon plus the global media keys.
 *
 * The media keys are registered globally, which is how every desktop music
 * player behaves — the point of the key is to work while the app is in the
 * background. globalShortcut is released for us on will-quit.
 */
export function setupTray(window: BrowserWindow, iconPath: string): void {
  const image = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
  image.setTemplateImage(true) // macOS menu bar: follows the light/dark menu bar.
  tray = new Tray(image)
  render(window)

  tray.on('click', () =>
    !window.isDestroyed() && window.isVisible() ? window.hide() : show(window)
  )

  for (const [accelerator, command] of [
    ['MediaPlayPause', 'playpause'],
    ['MediaNextTrack', 'next'],
    ['MediaPreviousTrack', 'previous'],
    ['MediaStop', 'stop']
  ] as [string, MediaCommand][]) {
    // Fails when another player already holds the key. Not fatal, and not worth
    // a dialog — the in-app controls still work.
    if (!globalShortcut.register(accelerator, () => send(command))) {
      console.warn('[tray] media key unavailable:', accelerator)
    }
  }

  app.on('will-quit', () => globalShortcut.unregisterAll())
}
