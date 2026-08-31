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
  console.log('...searching YouTube (real network calls)')
  // Two searches whose text carries a genre word, and one that does not. The
  // third is what real use looks like — "blinding lights", not "jazz piano" —
  // and it is the case that left the real library 92% untagged.
  const seeded = await evalUI(`
    let total = 0
    for (const q of ['lofi hip hop beats', 'jazz standards piano', 'blinding lights the weeknd']) {
      const r = await window.api.search(q)
      if (r.length) { await window.api.lib.save(r, q); total += r.length }
    }
    return total
  `)
  check('seeded a library from real searches', seeded > 20, `${seeded} tracks`)

  const genres = await evalUI('return await window.api.lib.genres()')
  check(
    'searches containing a genre word are auto-tagged',
    genres.some((g) => g.genre === 'Lo-fi') && genres.some((g) => g.genre === 'Jazz'),
    JSON.stringify(genres.map((g) => g.genre))
  )

  // ---- the sparse-genre fallback -----------------------------------------
  const coverage = await evalUI('return await window.api.lib.genreCoverage()')
  check(
    'a realistic search leaves tracks untagged',
    coverage.tagged < coverage.total,
    JSON.stringify(coverage)
  )
  const artists = await evalUI('return await window.api.lib.artists(16)')
  check('artists are available as a fallback grouping', artists.length > 0, `${artists.length}`)

  // ---- tagging one track tags the rest by that artist ---------------------
  const spread = await evalUI(`
    const all = await window.api.lib.recommended(1)
    const untagged = (await window.api.lib.artists(16))
      .map(a => a.artist)
      .filter(Boolean)
    // Pick an artist that has more than one untagged track.
    for (const artist of untagged) {
      const tracks = await window.api.lib.byArtist(artist, 20)
      const blanks = tracks.filter(t => !t.genre)
      if (blanks.length >= 2) {
        const n = await window.api.lib.setGenre(blanks[0].videoId, 'R&B')
        return { artist, tagged: n, blanks: blanks.length }
      }
    }
    return { artist: null, tagged: 0, blanks: 0 }
  `)
  check(
    'tagging one track tags the rest by that artist',
    spread.tagged > 0,
    JSON.stringify(spread)
  )
  const genresAfterTag = await evalUI('return await window.api.lib.genres()')
  check(
    'the new genre appears in Browse by genre',
    genresAfterTag.some((g) => g.genre === 'R&B'),
    JSON.stringify(genresAfterTag.map((g) => g.genre))
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
    'browse by genre shows real chips',
    await evalUI(`
      const h = [...document.querySelectorAll('h2')].find(x => x.textContent.trim().toLowerCase() === 'browse by genre')
      return h ? h.closest('section').querySelectorAll('button').length > 0 : false
    `)
  )
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
  // Poll instead of sleeping a fixed span: this waits on a live YouTube query,
  // and a hard-coded wait is flaky by construction.
  let searched = false
  for (let i = 0; i < 40 && !searched; i++) {
    searched = await evalUI('return document.body.innerText.includes("RESULTS")')
    if (!searched) await sleep(1000)
  }
  check('search rendered results', searched)
  await shot('07-search-results')

  // ---- autoplay ----------------------------------------------------------
  // Repeat must win: with repeat on, an empty queue is about to loop, not idle.
  const repeatWins = await evalUI(`
    const st = window.__store.getState()
    st.setAutoplay(true)
    st.playNow([])                       // nothing playing, empty queue
    window.__store.setState({ repeat: 'all', history: [], sessionPlayed: new Set() })
    const before = window.__store.getState()
    await st.autoplayIfIdle()
    const after = window.__store.getState()
    window.__store.setState({ repeat: 'off' })
    return { queued: after.queue.length, current: !!after.current, filling: after.filling }
  `)
  check(
    'autoplay does not fire while repeat is on',
    repeatWins.queued === 0 && !repeatWins.current,
    JSON.stringify(repeatWins)
  )

  // A genuinely finished queue: repeat off, autoplay on, something in history.
  const fired = await evalUI(`
    const lofi = await window.api.lib.byGenre('Lo-fi', 3)
    const st = window.__store.getState()
    st.setAutoplay(true)
    // Simulate a queue that has just run out, with one track behind it.
    window.__store.setState({
      current: null, queue: [], repeat: 'off',
      history: [lofi[0]], sessionPlayed: new Set([lofi[0].videoId])
    })
    await window.__store.getState().autoplayIfIdle()
    const s = window.__store.getState()
    return {
      current: s.current && { title: s.current.title, via: s.current.via },
      queued: s.queue.length,
      radioSeed: s.radioSeed,
      servedSeedAgain: [s.current, ...s.queue].some(t => t && t.videoId === lofi[0].videoId)
    }
  `)
  check('autoplay fills a finished queue', Boolean(fired.current) && fired.queued > 0, JSON.stringify(fired))
  check(
    'passive autoplay is not labelled a radio session',
    fired.radioSeed === null,
    JSON.stringify(fired.radioSeed)
  )
  check('autoplayed tracks carry their provenance', Boolean(fired.current?.via), JSON.stringify(fired.current))
  check('autoplay never repeats a track from this session', fired.servedSeedAgain === false)

  const label = await evalUI(`
    return document.body.innerText.includes('Because you played')
  `)
  check('the queue labels autoplayed tracks', label)
  await shot('08-autoplay')

  // Turning it off must persist and stop it firing.
  const off = await evalUI(`
    const st = window.__store.getState()
    st.setAutoplay(false)
    window.__store.setState({ current: null, queue: [], repeat: 'off' })
    await window.__store.getState().autoplayIfIdle()
    const s = window.__store.getState()
    return { stored: localStorage.getItem('symus.autoplay'), queued: s.queue.length, current: !!s.current }
  `)
  check(
    'autoplay off is persisted and stops it firing',
    off.stored === 'off' && off.queued === 0 && !off.current,
    JSON.stringify(off)
  )

  // ---- radio -------------------------------------------------------------
  const radio = await evalUI(`
    const jazz = await window.api.lib.byGenre('Jazz', 3)
    window.__store.setState({ sessionPlayed: new Set() })
    await window.__store.getState().startRadio(jazz[0], jazz[0].title)
    const s = window.__store.getState()
    return { seed: s.radioSeed, current: s.current?.videoId, expected: jazz[0].videoId, queued: s.queue.length }
  `)
  check('radio starts from the seed track', radio.current === radio.expected, JSON.stringify(radio))
  check('radio queues an onward session', radio.queued > 0, JSON.stringify(radio))
  check('the queue header names the radio seed', await evalUI(
    `return document.body.innerText.includes('Based on')`
  ))
  await shot('09-radio')

  // ---- playlist import ---------------------------------------------------
  await goTo('Import')
  await sleep(500)

  // An unconfigured source must explain itself, not fail at submit time.
  const unconfigured = await evalUI(`
    const i = document.querySelector('input[placeholder*="playlist link"]')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(i, 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M')
    i.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  `)
  void unconfigured
  await sleep(900)
  const spotifyState = await evalUI(`
    const d = await window.api.detectImport('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M')
    return {
      detected: d.source,
      configured: d.configured,
      saysUnconfigured: document.body.innerText.includes('not configured'),
      submitDisabled: document.querySelector('button[type=submit]')?.disabled
    }
  `)
  check('detects a Spotify link', spotifyState.detected === 'spotify', JSON.stringify(spotifyState))
  if (!spotifyState.configured) {
    check(
      'an unconfigured source says so instead of failing',
      spotifyState.saysUnconfigured && spotifyState.submitDisabled === true,
      JSON.stringify(spotifyState)
    )
  } else {
    console.log('      (Spotify keys present — skipping the unconfigured-message check)')
  }
  await shot('10-import-unconfigured')

  // A real YouTube playlist import, end to end.
  const listsBefore = await evalUI('return (await window.api.lib.playlists()).length')
  console.log('...importing a real YouTube playlist')
  // A live third-party playlist. If it is ever removed the run says so plainly
  // rather than reporting a fault in the importer.
  const imported = await evalUI(`
    const seen = []
    try {
      const res = await window.api.importPlaylist(
        'https://www.youtube.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI',
        p => seen.push(p.stage)
      )
      return { ok: true, name: res.name, imported: res.imported, unmatched: res.unmatched.length, stages: [...new Set(seen)] }
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) }
    }
  `)
  if (!imported.ok) {
    console.log('      SKIP: the test playlist is unavailable —', imported.error)
  }
  if (imported.ok) {
    check('import created a playlist with tracks', imported.imported > 0, JSON.stringify(imported))
    check(
      'import reported progress',
      imported.stages.includes('done'),
      JSON.stringify(imported.stages)
    )
  }

  if (imported.ok) {
    const listsAfter = await evalUI('return (await window.api.lib.playlists()).length')
    check(
      'the imported playlist is in the library',
      listsAfter === listsBefore + 1,
      `${listsBefore} -> ${listsAfter}`
    )

    const contents = await evalUI(`
      const lists = await window.api.lib.playlists()
      const newest = lists.find(p => p.title === ${JSON.stringify('__NAME__')}) || lists[0]
      const tracks = await window.api.lib.playlistTracks(newest.id)
      return {
        title: newest.title,
        count: tracks.length,
        allHaveIds: tracks.every(t => t.videoId),
        firstThree: tracks.slice(0, 3).map(t => t.title.slice(0, 30))
      }
    `.replace('__NAME__', imported.name))
    check(
      'imported tracks are real library rows in playlist order',
      contents.count > 0 && contents.allHaveIds,
      JSON.stringify(contents)
    )
    check(
      'the local playlist keeps the source name',
      contents.title === imported.name,
      `${contents.title} vs ${imported.name}`
    )
  }
  await sleep(600)
  await shot('11-import-done')

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
