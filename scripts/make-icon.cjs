// Rasterises build/icon.svg into every PNG the packagers and the runtime need.
//
//   npm run icons
//
// Runs as an Electron main process because Electron is already a dependency and
// Chromium is the best SVG renderer on this machine — no image library to add,
// and the output matches what the app itself would draw.
//
// electron-builder converts build/icon.png into the Windows .ico and macOS
// .icns at package time, so those are not generated here.
const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')

const ROOT = join(__dirname, '..')
const SVG = readFileSync(join(ROOT, 'build', 'icon.svg'), 'utf8')
const LINUX_SIZES = [16, 32, 48, 64, 128, 256, 512]

app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.disableHardwareAcceleration() // Offscreen capture is more reliable without a GPU.

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true }
  })

  // Margin-free full-bleed page: capturePage must see the artwork edge to edge.
  const page = `<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}
    svg{display:block;width:1024px;height:1024px}</style>${SVG}`
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`)

  const shot = await window.capturePage({ x: 0, y: 0, width: 1024, height: 1024 })
  if (shot.isEmpty()) throw new Error('capturePage returned nothing')

  const write = (path, image) => {
    writeFileSync(join(ROOT, path), image.toPNG())
    console.log('wrote', path, `${image.getSize().width}px`)
  }

  // The master. electron-builder reads this one for .ico and .icns.
  write('build/icon.png', shot)
  // The window and tray icon, loaded at runtime via ?asset.
  write('resources/icon.png', shot.resize({ width: 512, height: 512, quality: 'best' }))

  mkdirSync(join(ROOT, 'build', 'icons'), { recursive: true })
  for (const size of LINUX_SIZES) {
    write(`build/icons/${size}x${size}.png`, shot.resize({ width: size, height: size, quality: 'best' }))
  }

  // Sanity: a fully transparent or fully black icon means the SVG failed to
  // render and every downstream artifact would ship blank.
  const { width, height } = shot.getSize()
  const bitmap = shot.toBitmap()
  const centre = (height / 2) * width * 4 + (width / 2) * 4
  const opaque = bitmap[centre + 3] > 200
  const coloured = bitmap[centre] !== bitmap[centre + 1] || bitmap[centre + 1] !== bitmap[centre + 2]
  console.log(
    opaque && coloured
      ? 'ICONS OK'
      : `ICONS SUSPECT: centre pixel rgba(${[...bitmap.slice(centre, centre + 4)].join(',')})`
  )
  app.exit(opaque && coloured ? 0 : 1)
})
