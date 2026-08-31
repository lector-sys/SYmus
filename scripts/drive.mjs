// Drives the built app over the DevTools protocol: renderer on 9222, main
// process on 9229. Node 22 has fetch and WebSocket built in, so this needs no
// automation dependency.
//
//   npm run build && node scripts/drive.mjs
//
// Screenshots land in scripts/shots/.
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import electron from 'electron'

const SHOTS = join(import.meta.dirname, 'shots')
mkdirSync(SHOTS, { recursive: true })
const userData = mkdtempSync(join(tmpdir(), 'symus-drive-'))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Polls a DevTools endpoint until it answers, then returns its target list. */
async function targets(port, match) {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const hit = list.find(match)
      if (hit) return hit
    } catch {
      /* not up yet */
    }
    await sleep(500)
  }
  throw new Error(`no DevTools target on ${port}`)
}

/** Minimal CDP client: send(method, params) -> result. */
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl)
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = () => rej(new Error(`cannot connect to ${wsUrl}`))
  })
  let id = 0
  const pending = new Map()
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data)
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    msg.error ? p.rej(new Error(JSON.stringify(msg.error))) : p.res(msg.result)
  }
  return {
    send: (method, params = {}) =>
      new Promise((res, rej) => {
        const n = ++id
        pending.set(n, { res, rej })
        ws.send(JSON.stringify({ id: n, method, params }))
        setTimeout(() => pending.has(n) && rej(new Error(`${method} timed out`)), 120_000)
      }),
    close: () => ws.close()
  }
}

// SYMUS_BIN drives a packaged build instead of the dev one, which is the only
// way to catch asar / unpacked-resource problems before shipping an installer.
const bin = process.env.SYMUS_BIN || electron
const child = spawn(
  bin,
  [
    ...(process.env.SYMUS_BIN ? [] : ['.']),
    '--remote-debugging-port=9222',
    '--inspect=9229',
    `--user-data-dir=${userData}`,
    '--no-sandbox'
  ],
  { stdio: ['ignore', 'inherit', 'inherit'] }
)

let failures = 0
const check = (label, cond, detail) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : `  -> ${detail ?? ''}`}`)
  if (!cond) failures++
}

try {
  const page = await targets(9222, (t) => t.type === 'page' && !t.url.startsWith('devtools:'))
  const ui = await connect(page.webSocketDebuggerUrl)
  const mainTarget = await targets(9229, (t) => t.webSocketDebuggerUrl)
  const main = await connect(mainTarget.webSocketDebuggerUrl)
  await ui.send('Runtime.enable')
  await ui.send('Page.enable')
  await main.send('Runtime.enable')

  /** Evaluates in the renderer and returns the JSON value. */
  const evalUI = async (expr) => {
    const r = await ui.send('Runtime.evaluate', {
      expression: `(async () => { ${expr} })()`,
      awaitPromise: true,
      returnByValue: true
    })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
    return r.result.value
  }
  const evalMain = async (expr) => {
    const r = await main.send('Runtime.evaluate', {
      expression: `(async () => { ${expr} })()`,
      awaitPromise: true,
      returnByValue: true,
      includeCommandLineAPI: true
    })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
    return r.result.value
  }
  const shot = async (name) => {
    const { data } = await ui.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(data, 'base64'))
    console.log(`      shot: scripts/shots/${name}.png`)
  }

  // Chromium suspends style recalc and animations in an occluded window, so
  // every computed-style assertion below would read the previous frame's values.
  await evalMain(
    'const {BrowserWindow} = require("electron");' +
      'const w = BrowserWindow.getAllWindows()[0]; w.show(); w.focus(); return true'
  )
  await sleep(2500)
  check('the window is actually visible', await evalUI('return !document.hidden'))
  check('renderer booted', await evalUI('return !!document.querySelector("nav")'))

  /** Clicks a sidebar entry by its label and waits for the view to settle. */
  const goTo = async (label) => {
    await evalUI(`
      const b = [...document.querySelectorAll('nav button')].find(b => b.textContent.trim().startsWith(${JSON.stringify(label)}))
      if (!b) throw new Error('no nav button: ' + ${JSON.stringify(label)})
      b.click(); return true
    `)
    await sleep(700)
  }

  // ---- tray + media keys live in the main process ------------------------
  check(
    'tray icon created',
    await evalMain(
      'const {Tray} = require("electron"); return typeof Tray === "function" && process.type === "browser"'
    )
  )
  const keys = await evalMain(
    'const {globalShortcut} = require("electron");' +
      'return ["MediaPlayPause","MediaNextTrack","MediaPreviousTrack"].filter(k => globalShortcut.isRegistered(k))'
  )
  check('media keys registered', keys.length === 3, JSON.stringify(keys))

  // ---- seed a library varied enough for every Home row to have content ----
  console.log('...searching YouTube for three genres (real network calls)')
  const seeded = await evalUI(`
    let total = 0
    for (const q of ['lofi hip hop beats', 'jazz standards piano', 'classic rock anthems']) {
      const r = await window.api.search(q)
      if (r.length) { await window.api.lib.save(r, q); total += r.length }
    }
    return total
  `)
  check('seeded a multi-genre library', seeded > 20, `${seeded} tracks`)

  const genres = await evalUI('return await window.api.lib.genres()')
  check(
    'auto-tagged at least three genres',
    genres.length >= 3,
    JSON.stringify(genres.map((g) => g.genre))
  )

  // Build a taste profile: like two jazz tracks, play some repeatedly. That is
  // what "Made for you" and "Most listened" read from.
  await evalUI(`
    const jazz = await window.api.lib.byGenre('Jazz', 5)
    const lofi = await window.api.lib.byGenre('Lo-fi', 5)
    for (const t of jazz.slice(0, 2)) await window.api.lib.like(t, true)
    for (let i = 0; i < 5; i++) await window.api.lib.play(lofi[0])
    for (let i = 0; i < 3; i++) await window.api.lib.play(lofi[1])
    await window.api.lib.play(jazz[2])
    await window.api.lib.playlistCreate('Late Night', jazz.slice(0, 4))
    await window.api.lib.playlistCreate('Focus', lofi.slice(0, 3))
    await window.__store.getState().refreshLikes()
    window.__store.getState().libraryChanged()
    return true
  `)

  const [recent, top, made, lists] = await evalUI(`
    return await Promise.all([
      window.api.lib.recent(), window.api.lib.top(),
      window.api.lib.recommended(), window.api.lib.playlists()
    ])
  `)
  check('recently played is populated', recent.length >= 3, `${recent.length}`)
  check('most listened ranks by play count', top[0]?.plays === 5, JSON.stringify(top[0]?.plays))
  check('made for you returns unheard tracks', made.length > 0, `${made.length}`)
  check('two playlists exist', lists.length === 2, JSON.stringify(lists.map((p) => p.title)))

  // ---- the Home page renders every row -----------------------------------
  await goTo('Home')
  // The eyebrows are uppercased in CSS, so textContent still carries the source
  // casing — compare lowercased or every row looks missing.
  const rows = await evalUI(
    'return [...document.querySelectorAll("h2")].map(h => h.textContent.trim().toLowerCase())'
  )
  for (const row of [
    'recently played',
    'made for you',
    'your playlists',
    'most listened',
    'browse by genre'
  ]) {
    check(`home row: ${row}`, rows.includes(row), JSON.stringify(rows))
  }
  check(
    'home shelves are horizontally scrollable',
    await evalUI('return document.querySelectorAll(".no-scrollbar").length >= 3')
  )
  await shot('01-home')

  // ---- play something, so the lit-row treatment is visible ---------------
  await evalUI(`
    const lofi = await window.api.lib.byGenre('Lo-fi', 6)
    window.__store.getState().playNow(lofi)
    return true
  `)
  await sleep(1200)
  check('now playing is set', Boolean(await evalUI('return window.__store.getState().current')))
  await shot('02-home-playing')

  check('volume starts at full', (await evalUI('return window.__store.getState().volume')) === 1)

  await goTo('Library')
  await shot('03-library')

  await goTo('Liked')
  const litRow = await evalUI(
    'return !!document.querySelector(\'[class*="bg-ember"]\') || !!document.querySelector(".text-ember")'
  )
  check('a row is lit for the current track', litRow)
  await shot('04-liked')

  await goTo('Late Night')
  const marked = await evalUI(
    `return [...document.querySelectorAll('nav [aria-current=\"page\"]')].map(b => b.textContent.trim())`
  )
  check(
    'sidebar marks exactly the open playlist',
    marked.length === 1 && marked[0] === 'Late Night',
    JSON.stringify(marked)
  )
  const anim = await evalUI(`
    const e = document.querySelector('.view-enter')
    if (!e) return { found: false }
    const cs = getComputedStyle(e)
    return {
      found: true,
      opacity: cs.opacity,
      animationName: cs.animationName,
      animationFillMode: cs.animationFillMode,
      running: e.getAnimations().map(a => a.playState),
      visible: !document.hidden
    }
  `)
  // Guards the real invariant: a page is never invisible, animating or not.
  check('the view is never rendered invisible', anim.opacity === '1', JSON.stringify(anim))
  const navStyles = await evalUI(`
    return [...document.querySelectorAll('nav button')].map(b => ({
      label: b.textContent.trim().slice(0, 14),
      current: b.getAttribute('aria-current'),
      bg: getComputedStyle(b).backgroundColor,
      hasRaised: b.className.includes('bg-raised')
    }))
  `)
  const activeBg = await evalUI(`
    const el = document.querySelector('nav [aria-current="page"]')
    return el ? getComputedStyle(el).backgroundColor : 'NO ACTIVE ITEM'
  `)
  check(
    'the open page is visibly marked in the sidebar',
    activeBg !== 'rgba(0, 0, 0, 0)' && activeBg !== 'NO ACTIVE ITEM',
    activeBg
  )
  check(
    'only the current page is styled as active',
    navStyles.filter((n) => n.bg !== 'rgba(0, 0, 0, 0)').every((n) => n.current === 'page'),
    JSON.stringify(navStyles)
  )
  await shot('05-playlist')

  await goTo('Search')
  await evalUI(`
    const i = document.querySelector('input[placeholder*="listen"]')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(i, 'miles davis kind of blue')
    i.dispatchEvent(new Event('input', { bubbles: true }))
    i.form.requestSubmit()
    return true
  `)
  await sleep(1200)
  check(
    'navigating did not disturb the volume',
    (await evalUI('return window.__store.getState().volume')) === 1,
    await evalUI(
      'return JSON.stringify({v: window.__store.getState().volume, m: window.__store.getState().muted})'
    )
  )
  await shot('06-search-loading')
  await sleep(14000)
  check(
    'search rendered results',
    (await evalUI('return document.body.innerText.includes("RESULTS")')) === true
  )
  await shot('07-search-results')

  // ---- media keys still drive the redesigned bar -------------------------
  const before = await evalUI('return window.__store.getState().current?.videoId')
  await evalMain(
    'const {BrowserWindow} = require("electron");' +
      'BrowserWindow.getAllWindows()[0].webContents.send("media","next"); return true'
  )
  await sleep(600)
  const after = await evalUI('return window.__store.getState().current?.videoId')
  check(
    'media "next" advanced the track',
    Boolean(before) && before !== after,
    `${before} -> ${after}`
  )

  await evalMain(
    'const {BrowserWindow} = require("electron");' +
      'BrowserWindow.getAllWindows()[0].webContents.send("media","playpause"); return true'
  )
  await sleep(400)
  check(
    'media "playpause" toggled playback',
    (await evalUI('return window.__store.getState().playing')) === false
  )

  console.log(failures ? `\n${failures} FAILURES` : '\nDRIVE OK')
} finally {
  child.kill()
  // Windows keeps a handle on the SQLite file for a moment after the kill.
  // The dir is in %TEMP%; leaving it behind is not worth failing the run over.
  try {
    rmSync(userData, { recursive: true, force: true })
  } catch {
    /* the OS will clear it */
  }
}
process.exit(failures ? 1 : 0)
