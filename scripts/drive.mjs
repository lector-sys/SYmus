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
// The app keeps its library in userData; the restore checks watch that file.
const dbUnderTest = join(userData, 'symus.db')

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
  const evalOnce = async (expr) => {
    const r = await ui.send('Runtime.evaluate', {
      expression: `(async () => { ${expr} })()`,
      awaitPromise: true,
      returnByValue: true
    })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
    return r.result.value
  }

  // Chromium garbage-collects the promise behind an awaited evaluate when the
  // renderer is busy — a radio session filling in the background is enough — and
  // reports it as an error even though nothing was wrong with the expression.
  // Retried once rather than left to kill a four-minute run. The expression may
  // already have had an effect, so this trades a rare repeated action for a run
  // that survives a GC hiccup.
  const evalUI = async (expr) => {
    try {
      return await evalOnce(expr)
    } catch (err) {
      if (!String(err.message).includes('Promise was collected')) throw err
      console.log('      (renderer collected the evaluate; retrying once)')
      await sleep(500)
      return evalOnce(expr)
    }
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
  check('tagging one track tags the rest by that artist', spread.tagged > 0, JSON.stringify(spread))
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
  // Assert on rendered rows, not on a label: the results header now reads
  // "12 songs" or "12 results" depending on the active filter tab.
  let searchRows = 0
  for (let i = 0; i < 40 && searchRows === 0; i++) {
    searchRows = await evalUI(`
      const main = document.querySelector('main')
      return main ? main.querySelectorAll('img').length : 0
    `)
    if (!searchRows) await sleep(1000)
  }
  check('search rendered results', searchRows > 0, `${searchRows} rows`)
  await shot('07-search-results')

  // ---- search suggestions, filter tabs, history --------------------------
  const suggestions = await evalUI(`return await window.api.searchHistory.suggest('blinding')`)
  check(
    'autocomplete returns suggestions',
    suggestions.length > 0,
    JSON.stringify(suggestions.slice(0, 3))
  )

  const tabs = await evalUI(`
    return [...document.querySelectorAll('button')]
      .map(b => b.textContent.trim())
      .filter(t => ['Songs','Videos','Playlists','Artists'].some(x => t.startsWith(x)))
  `)
  check('filter tabs are present', tabs.length >= 4, JSON.stringify(tabs))
  // An Albums tab would be permanently empty until album metadata exists.
  check(
    'no empty Albums tab is shipped',
    !tabs.some((t) => t.startsWith('Albums')),
    JSON.stringify(tabs)
  )

  const histFlow = await evalUI(`
    await window.api.searchHistory.clear()
    await window.api.searchHistory.record('miles davis')
    const after = await window.api.searchHistory.recent()
    const cleared = (await window.api.searchHistory.clear(), (await window.api.searchHistory.recent()).length)
    return { after, cleared }
  `)
  check(
    'search history records then clears',
    histFlow.after[0] === 'miles davis' && histFlow.cleared === 0,
    JSON.stringify(histFlow)
  )

  // ---- lyrics ------------------------------------------------------------
  const lyrics = await evalUI(`
    const t = { videoId: 'fHI8X4OXluQ', title: 'The Weeknd - Blinding Lights (Official Video)', artist: 'TheWeekndVEVO', duration: 200 }
    const r = await window.api.lyrics.get(t)
    return { status: r.status, synced: !!(r.lines && r.lines.length), first: r.lines && r.lines[0] }
  `)
  check('lyrics resolve for a real track', lyrics.status === 'found', JSON.stringify(lyrics))
  check('synced timing data is returned', lyrics.synced === true, JSON.stringify(lyrics.first))

  // A track with no lyrics must report none, never invented words.
  const noLyrics = await evalUI(`
    const r = await window.api.lyrics.get({ videoId: 'aaaaaaaaaaa', title: 'Zzzq Nonexistent Track Xyzzy', artist: 'Nobody At All', duration: 123 })
    return r.status
  `)
  check('an unknown track reports no lyrics', noLyrics === 'none', noLyrics)

  await evalUI('window.__store.getState().toggleLyrics(); return true')
  await sleep(1500)
  check(
    'the lyrics panel renders',
    await evalUI(`return document.body.innerText.toLowerCase().includes('lyrics')`)
  )
  await shot('12-lyrics')
  await evalUI('window.__store.getState().toggleLyrics(); return true')

  // ---- explore -----------------------------------------------------------
  await goTo('Explore')
  const explorePlan = await evalUI('return await window.api.explore.plan()')
  check(
    'explore plans shelves from the library',
    explorePlan.length > 0,
    JSON.stringify(explorePlan.map((sh) => sh.title))
  )

  // Cold load is ~1.7s per shelf, serialised. Poll rather than sleeping.
  let shelfCount = 0
  for (let i = 0; i < 40 && shelfCount === 0; i++) {
    shelfCount = await evalUI(`
      const main = document.querySelector('main')
      return main && main.innerText.includes('Explore') ? main.querySelectorAll('h2').length : 0
    `)
    if (!shelfCount) await sleep(1000)
  }
  check('explore renders at least one shelf', shelfCount > 0, `${shelfCount} rows`)

  // Explore is allowed to say "Charts" — one tab is called that, because it is
  // where a listener looks for it. What it may never do is imply the numbers
  // come from somewhere they do not, so the claim is what gets tested, across
  // every tab, and the Charts tab has to say out loud whose listening it is.
  const claims = await evalUI(`
    const tabs = [...document.querySelectorAll('[role=tab]')]
    const seen = {}
    for (const tab of tabs) {
      tab.click()
      await new Promise(r => setTimeout(r, 700))
      seen[tab.textContent.trim()] = document.querySelector('main').innerText
    }
    const back = tabs.find(t => t.textContent.trim() === 'New releases')
    if (back) { back.click(); await new Promise(r => setTimeout(r, 700)) }
    return seen
  `)
  const overclaiming = Object.entries(claims).filter(([, text]) =>
    // "not a global chart" is a disclaimer, not a claim, so the negated form is
    // removed before the ban list runs — otherwise saying the honest thing is
    // what trips the check.
    /\bofficial\b|\bglobal chart|\bworldwide\b|trending on youtube|billboard/i.test(
      text.replace(/\bnot a global chart\b/gi, '')
    )
  )
  check(
    'no tab claims a source it does not have',
    overclaiming.length === 0,
    JSON.stringify(overclaiming.map(([tab]) => tab))
  )
  check(
    'the Charts tab says whose listening it is',
    /not a global chart/i.test(claims['Charts'] ?? ''),
    JSON.stringify((claims['Charts'] ?? '').split('\n').slice(0, 3))
  )
  check(
    'every tab explains where its rows come from',
    Object.values(claims).every((text) =>
      /found by search|recent uploads|your listening|your library/i.test(text)
    ),
    JSON.stringify(Object.keys(claims))
  )
  await shot('13-explore')

  // ---- the explore tab bar -----------------------------------------------
  const exploreTabs = await evalUI(`
    const bar = document.querySelector('[role=tablist]')
    if (!bar) return { present: false }
    const tabs = [...bar.querySelectorAll('[role=tab]')]
    return {
      present: true,
      labels: tabs.map(t => t.textContent.trim()),
      selected: tabs.filter(t => t.getAttribute('aria-selected') === 'true').map(t => t.textContent.trim())
    }
  `)
  check('Explore has a tab bar', exploreTabs.present, JSON.stringify(exploreTabs))
  check(
    'exactly one tab is selected',
    exploreTabs.selected.length === 1 && exploreTabs.selected[0] === 'New releases',
    JSON.stringify(exploreTabs)
  )
  check(
    'New albums and singles leads the New releases tab',
    await evalUI(
      `return [...document.querySelectorAll('main h2, main .eyebrow')].some(h => h.textContent.trim() === 'New albums and singles')`
    ),
    JSON.stringify(exploreTabs.labels)
  )

  // Switching must swap the panel and the promise under the title, not just
  // repaint the button: each tab is best-effort about something different.
  const switched = await evalUI(`
    const sub = () => document.querySelector('main').innerText.split('\\n').slice(0, 3).join(' | ')
    const before = sub()
    const moods = [...document.querySelectorAll('[role=tab]')].find(t => t.textContent.trim() === 'Moods and genres')
    moods.click()
    await new Promise(r => setTimeout(r, 900))
    return {
      before,
      after: sub(),
      selected: [...document.querySelectorAll('[role=tab][aria-selected=true]')].map(t => t.textContent.trim()),
      tiles: document.querySelectorAll('.genre-tile').length
    }
  `)
  check(
    'choosing a tab swaps the panel',
    switched.selected.length === 1 &&
      switched.selected[0] === 'Moods and genres' &&
      switched.tiles > 0,
    JSON.stringify(switched)
  )
  check(
    'and the promise under the title changes with it',
    switched.before !== switched.after,
    JSON.stringify(switched)
  )

  // ---- moods and genres --------------------------------------------------
  const tiles = await evalUI('return await window.api.explore.tiles()')
  check(
    'the grid offers both tagged genres and untouched ones',
    tiles.some((t) => t.count > 0) && tiles.some((t) => t.count === 0),
    JSON.stringify(tiles.slice(0, 6))
  )

  const grid = await evalUI(`
    const els = [...document.querySelectorAll('.genre-tile')]
    return {
      rendered: els.length,
      // Distinct backgrounds prove the per-tile hue reached CSS, rather than
      // every tile sharing one class and one colour.
      colours: new Set(els.slice(0, 8).map(e => getComputedStyle(e).backgroundColor)).size,
      readable: els.length ? getComputedStyle(els[0]).color !== getComputedStyle(els[0]).backgroundColor : false
    }
  `)
  check(
    'every tile renders',
    grid.rendered === tiles.length,
    JSON.stringify({ ...grid, tiles: tiles.length })
  )
  check('tiles are individually coloured', grid.colours > 1 && grid.readable, JSON.stringify(grid))
  await shot('19-moods')

  // A genre with nothing behind it is the interesting case: Devotional has no
  // inference rule, so nothing can land in it except through Find more.
  const opened = await evalUI(`
    const tile = [...document.querySelectorAll('.genre-tile')].find(e => e.textContent.startsWith('Devotional'))
    if (!tile) return { found: false }
    tile.click()
    await new Promise(r => setTimeout(r, 800))
    const view = window.__nav.getState().view
    return { found: true, kind: view.kind, name: view.name, rows: (await window.api.lib.byGenre('Devotional', 200)).length }
  `)
  check(
    'a tile opens its genre page',
    opened.found && opened.kind === 'genre' && opened.name === 'Devotional',
    JSON.stringify(opened)
  )
  check('and that genre starts empty', opened.rows === 0, JSON.stringify(opened))

  console.log('...finding more in an empty genre')
  const found = await evalUI(`
    const b = [...document.querySelectorAll('main button')].find(b => b.textContent.trim() === 'Find more')
    if (!b) return { found: false }
    b.click()
    // One yt-dlp search, queued behind whatever Explore is already running.
    for (let i = 0; i < 60; i++) {
      const tagged = await window.api.lib.byGenre('Devotional', 200)
      if (tagged.length) {
        await new Promise(r => setTimeout(r, 900))
        return {
          found: true,
          tagged: tagged.length,
          rows: document.querySelectorAll('main img').length,
          sample: tagged.slice(0, 2).map(t => t.title.slice(0, 40))
        }
      }
      await new Promise(r => setTimeout(r, 1000))
    }
    return { found: true, tagged: 0, rows: 0 }
  `)
  check('Find more exists on a genre page', found.found)
  check(
    'it tags what it finds with the genre that was asked for',
    found.tagged > 0,
    JSON.stringify(found)
  )
  // The button is only useful if the page the user is standing on grows.
  check('and the page it is on fills in', found.rows > 0, JSON.stringify(found))
  await shot('20-genre-found')

  // ---- the charts tab ----------------------------------------------------
  // The tile click above left the app on a genre page, which has no tab bar.
  await goTo('Explore')
  await sleep(700)
  const charts = await evalUI(`
    const tab = [...document.querySelectorAll('[role=tab]')].find(t => t.textContent.trim() === 'Charts')
    if (!tab) return { present: false }
    tab.click()
    await new Promise(r => setTimeout(r, 1500))
    const text = document.querySelector('main').innerText.toLowerCase()
    const data = await window.api.explore.charts()
    return {
      present: true,
      text,
      tracks: text.includes('your top tracks'),
      artists: text.includes('your top artists'),
      topTrack: data.tracks[0] ? data.tracks[0].title : null,
      topPlays: data.tracks[0] ? data.tracks[0].plays : 0,
      sparse: data.sparse
    }
  `)
  check('Explore has a Charts tab', charts.present, JSON.stringify(charts.present))
  check(
    "it ranks this library's own tracks and artists",
    charts.tracks && charts.artists && charts.topPlays > 0,
    JSON.stringify({
      tracks: charts.tracks,
      artists: charts.artists,
      top: charts.topTrack,
      plays: charts.topPlays
    })
  )
  // The searched supplement only appears when the local numbers are too thin,
  // and when it does it has to name itself as a search.
  check(
    'a thin history is supplemented, and the supplement says it is a search',
    charts.sparse
      ? (charts.text ?? '').includes('popular right now (from search)')
      : !(charts.text ?? '').includes('popular right now'),
    JSON.stringify({ sparse: charts.sparse })
  )
  await shot('21-charts')

  // ---- the podcasts tab --------------------------------------------------
  console.log('...searching for talk uploads')
  const podcasts = await evalUI(`
    const tab = [...document.querySelectorAll('[role=tab]')].find(t => t.textContent.trim() === 'Podcasts')
    if (!tab) return { present: false }
    tab.click()

    // One yt-dlp search, then the row renders.
    let found = null
    for (let i = 0; i < 60 && !found; i++) {
      await new Promise(r => setTimeout(r, 1000))
      const main = document.querySelector('main')
      if (main.querySelectorAll('img').length) found = main.innerText.toLowerCase()
    }
    const data = await window.api.podcasts.discover()
    return {
      present: true,
      text: found,
      query: data.query,
      episodes: data.tracks.length,
      channels: data.channels.length,
      firstChannel: data.channels[0] ?? null
    }
  `)
  check('Explore has a Podcasts tab', podcasts.present, JSON.stringify(podcasts.present))
  check(
    'it finds talk uploads',
    podcasts.episodes > 0,
    JSON.stringify({ query: podcasts.query, episodes: podcasts.episodes })
  )
  // The row has to name the search it ran: there is no podcast directory here,
  // and a row that did not say so would imply one.
  check(
    'and the row names the search it ran',
    (podcasts.text ?? '').includes(String(podcasts.query).toLowerCase()),
    JSON.stringify({ query: podcasts.query, text: (podcasts.text ?? '').slice(0, 120) })
  )

  // The contentType tag is only worth having if the music paths read it.
  const leaked = await evalUI(`
    const episodes = (await window.api.podcasts.discover()).tracks.map(t => t.videoId)
    const made = await window.api.lib.recommended(50)
    const similar = await window.api.lib.similar(made[0] ?? { videoId: 'aaaaaaaaaaa', title: 'x', artist: null, thumbnailUrl: '', duration: 1 }, [], 50)
    return {
      inMadeForYou: made.filter(t => episodes.includes(t.videoId)).map(t => t.title),
      inAutoplay: similar.filter(t => episodes.includes(t.videoId)).map(t => t.title)
    }
  `)
  check(
    'episodes stay out of the music recommendations',
    leaked.inMadeForYou.length === 0 && leaked.inAutoplay.length === 0,
    JSON.stringify(leaked)
  )

  if (podcasts.firstChannel) {
    console.log('...following a channel')
    const followed = await evalUI(`
      const chip = [...document.querySelectorAll('main button')].find(
        b => b.textContent.trim() === ${JSON.stringify(podcasts.firstChannel.name)}
      )
      if (!chip) return { clicked: false }
      chip.click()

      // Following fetches that channel's uploads, which is another yt-dlp run.
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 1000))
        const list = await window.api.podcasts.following()
        const shown = document.querySelector('main').innerText
        if (list.length && shown.toUpperCase().includes(${JSON.stringify(podcasts.firstChannel.name.toUpperCase())})) {
          return { clicked: true, following: list.length, name: list[0].name, hasUnfollow: shown.includes('Unfollow') }
        }
      }
      return { clicked: true, following: (await window.api.podcasts.following()).length }
    `)
    check(
      'following a channel gives it its own row',
      followed.clicked && followed.following === 1 && followed.hasUnfollow === true,
      JSON.stringify(followed)
    )
    await shot('22-podcasts')

    const dropped = await evalUI(`
      const b = [...document.querySelectorAll('main button')].find(b => b.textContent.trim() === 'Unfollow')
      if (!b) return { found: false }
      b.click()
      await new Promise(r => setTimeout(r, 1200))
      return { found: true, following: (await window.api.podcasts.following()).length }
    `)
    check(
      'and unfollowing takes it away again',
      dropped.found && dropped.following === 0,
      JSON.stringify(dropped)
    )
  } else {
    check('the search returned a channel to follow', false, 'no channel id came back')
  }

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
  check(
    'autoplay fills a finished queue',
    Boolean(fired.current) && fired.queued > 0,
    JSON.stringify(fired)
  )
  check(
    'passive autoplay is not labelled a radio session',
    fired.radioSeed === null,
    JSON.stringify(fired.radioSeed)
  )
  check(
    'autoplayed tracks carry their provenance',
    Boolean(fired.current?.via),
    JSON.stringify(fired.current)
  )
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
  check(
    'the queue header names the radio seed',
    await evalUI(`return document.body.innerText.includes('Based on')`)
  )
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

    const contents = await evalUI(
      `
      const lists = await window.api.lib.playlists()
      const newest = lists.find(p => p.title === ${JSON.stringify('__NAME__')}) || lists[0]
      const tracks = await window.api.lib.playlistTracks(newest.id)
      return {
        title: newest.title,
        count: tracks.length,
        allHaveIds: tracks.every(t => t.videoId),
        firstThree: tracks.slice(0, 3).map(t => t.title.slice(0, 30))
      }
    `.replace('__NAME__', imported.name)
    )
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

  // ---- offline cache -----------------------------------------------------
  // A library track that has never been played must be refused: this is a cache
  // of audio you already streamed, not a download manager.
  const neverPlayed = await evalUI(`
    const t = { videoId: 'zzzzzzzzzzz', title: 'Never Played Fixture', artist: 'Nobody', thumbnailUrl: '', duration: 100 }
    await window.api.lib.save([t])
    try {
      await window.api.offline.save(t.videoId)
      return 'it downloaded anyway'
    } catch (err) {
      return String((err && err.message) || err)
    }
  `)
  check(
    'offline refuses a track you never played',
    /play it once first/i.test(neverPlayed),
    neverPlayed
  )

  console.log('...downloading one track for offline')
  // Resolution and download are timed apart, and neither may hang: this is the
  // one check that pulls a whole file off the CDN, so a stall here is reported
  // as a failure rather than killing the run at the CDP timeout.
  const offline = await evalUI(`
    // Not simply the newest play: this library is full of multi-hour lofi
    // streams, and downloading 700 MB proves nothing the shortest real track
    // does not. A track between one and fifteen minutes is a normal song, which
    // is what this path exists for.
    const recent = await window.api.lib.recent(30)
    // Duration 0 is a livestream or an unstarted premiere — the app itself
    // refuses to queue those, and neither has a file to download.
    // The shortest real song, because this check is about the path, not the
    // bytes: the same library also holds 133 MB uploads, which download fine and
    // take minutes doing it.
    const track = recent
      .filter((t) => t.duration >= 60)
      .sort((a, b) => a.duration - b.duration)[0]
    if (!track) return { ok: false, error: 'no ordinary-length track has been played yet' }
    const took = {}
    const step = async (name, work) => {
      const t0 = Date.now()
      const out = await Promise.race([
        work,
        new Promise((_, rej) => setTimeout(() => rej(new Error(name + ' stalled past 60s')), 60000))
      ])
      took[name] = Date.now() - t0
      return out
    }
    try {
      // Warms the URL cache in main, so the save below is download time alone.
      await step('resolve', window.api.prepare(track.videoId))
      const bytes = await step('download', window.api.offline.save(track.videoId))
      const status = await window.api.offline.status(track.videoId)
      const list = await window.api.offline.list()
      const summary = await window.api.offline.summary()
      const row = list.find(t => t.videoId === track.videoId)
      return { ok: true, videoId: track.videoId, title: track.title, seconds: track.duration, bytes, status, summary, listedBytes: row && row.bytes, took }
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err), videoId: track.videoId, seconds: track.duration, took }
    }
  `)
  if (!offline.ok) {
    // Nothing worth downloading is a skip, not a failure: it means this run
    // never played an ordinary-length track, which is about the library rather
    // than the code.
    if (/no ordinary-length track/.test(offline.error)) {
      console.log('      SKIP: offline checks —', offline.error)
    } else {
      check(
        'offline saved a played track',
        false,
        offline.error +
          ' ' +
          JSON.stringify({
            videoId: offline.videoId,
            seconds: offline.seconds,
            took: offline.took || {}
          })
      )
    }
  } else {
    check('the audio actually landed on disk', offline.bytes > 100_000, `${offline.bytes} bytes`)
    check(
      'the track reports itself cached',
      offline.status.cached === true,
      JSON.stringify(offline.status)
    )
    check(
      'it is listed with its size',
      offline.listedBytes === offline.bytes,
      JSON.stringify(offline)
    )
    check(
      'the summary counts it',
      offline.summary.count >= 1 && offline.summary.bytes >= offline.bytes,
      JSON.stringify(offline.summary)
    )

    await goTo('Downloaded')
    check(
      'the Downloaded view lists the saved track',
      await evalUI(
        `return document.querySelector('main').innerText.includes(${JSON.stringify(offline.title.slice(0, 24))})`
      ),
      offline.title
    )
    await shot('14-downloaded')

    // Removing must clear the row too, or the library keeps claiming a file
    // that is no longer there.
    const removed = await evalUI(`
      await window.api.offline.remove(${JSON.stringify(offline.videoId)})
      const status = await window.api.offline.status(${JSON.stringify(offline.videoId)})
      const summary = await window.api.offline.summary()
      return { cached: status.cached, count: summary.count }
    `)
    check(
      'remove clears both the file and the row',
      removed.cached === false && removed.count === 0,
      JSON.stringify(removed)
    )
  }

  // ---- artist page -------------------------------------------------------
  const artistPage = await evalUI(`
    const [top] = await window.api.lib.artists(1)
    if (!top) return { ok: false }
    window.__nav.getState().go({ kind: 'artist', name: top.artist })
    return { ok: true, artist: top.artist, expected: (await window.api.albums.artist(top.artist)).tracks.length }
  `)
  if (!artistPage.ok) {
    console.log('      SKIP: artist page — no artists in the library')
  } else {
    await sleep(1200)
    const rendered = await evalUI(`
      const main = document.querySelector('main')
      return { names: main.innerText.includes(${JSON.stringify(artistPage.artist)}), rows: main.querySelectorAll('img').length }
    `)
    check('the artist page names the artist', rendered.names, artistPage.artist)
    check(
      'the artist page renders their tracks',
      rendered.rows > 0,
      `${rendered.rows} rows for ${artistPage.expected} tracks`
    )
    await shot('15-artist')
  }

  // ---- mini player -------------------------------------------------------
  // A second window with its own renderer: what matters is that it loads the
  // mini route and that the main window's snapshot reaches it.
  const playingTitle = await evalUI('return window.__store.getState().current?.title ?? null')
  check(
    'mini toggle reports it opened',
    (await evalUI('return await window.api.mini.toggle()')) === true
  )
  await sleep(1500)
  // Window order is not guaranteed, so each window is identified by its URL:
  // the mini one must be the only one on screen.
  const windows = await evalMain(
    'const {BrowserWindow} = require("electron");' +
      'return BrowserWindow.getAllWindows().map(w => ({ mini: w.webContents.getURL().includes("mini"), visible: w.isVisible() }))'
  )
  check(
    'the mini window replaces the main one rather than sitting on it',
    windows.length === 2 && windows.every((w) => w.visible === w.mini),
    JSON.stringify(windows)
  )

  const miniTarget = await targets(9222, (t) => t.type === 'page' && t.url.endsWith('#mini'))
  const miniUi = await connect(miniTarget.webSocketDebuggerUrl)
  await miniUi.send('Runtime.enable')
  await miniUi.send('Page.enable')
  const miniText = (
    await miniUi.send('Runtime.evaluate', {
      expression: 'document.body.innerText',
      returnByValue: true
    })
  ).result.value
  check(
    'the mini window shows what is playing',
    Boolean(playingTitle) && miniText.includes(playingTitle.slice(0, 20)),
    `${JSON.stringify(miniText)} vs ${playingTitle}`
  )
  const miniShot = await miniUi.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(SHOTS, '16-mini.png'), Buffer.from(miniShot.data, 'base64'))
  console.log('      shot: scripts/shots/16-mini.png')
  miniUi.close()

  check(
    'closing the mini player reports it shut',
    (await evalUI('return await window.api.mini.close()')) === false
  )
  await sleep(800)
  check(
    'the main window comes back',
    await evalMain(
      'const {BrowserWindow} = require("electron"); return BrowserWindow.getAllWindows()[0].isVisible()'
    )
  )

  // ---- radio from a list header ------------------------------------------
  // The action existed on track rows and the artist page but not on the
  // album/playlist headers, which is where a whole list gets seeded from.
  await goTo('Late Night')
  await sleep(600)
  const headerRadio = await evalUI(`
    const b = [...document.querySelectorAll('main button')].find(b => b.textContent.trim() === 'Start radio')
    if (!b) return { present: false }
    window.__store.setState({ sessionPlayed: new Set() })
    b.click()
    return { present: true }
  `)
  check('the playlist header offers Start radio', headerRadio.present)
  if (headerRadio.present) {
    let seed = null
    for (let i = 0; i < 20 && !seed; i++) {
      seed = await evalUI('return window.__store.getState().radioSeed ?? null')
      if (!seed) await sleep(500)
    }
    check('it seeds the session with the playlist name', seed === 'Late Night', String(seed))
  }

  // The album header carries its own copy of the button, so it is checked
  // separately. Most YouTube uploads publish no album name, so the page is
  // reached directly and the control may legitimately be disabled.
  const albumRadio = await evalUI(`
    const [top] = await window.api.lib.artists(1)
    const { albums } = top ? await window.api.albums.artist(top.artist) : { albums: [] }
    const album = albums[0]
    window.__nav.getState().go({
      kind: 'album',
      name: album ? album.name : 'Unknown Album',
      artist: top ? top.artist : null
    })
    return { real: Boolean(album) }
  `)
  await sleep(900)
  check(
    'the album header offers Start radio',
    await evalUI(
      `return [...document.querySelectorAll('main button')].some(b => b.textContent.trim() === 'Start radio')`
    ),
    albumRadio.real ? 'a real album' : 'an empty album page'
  )

  // ---- context menu on shelf cards ---------------------------------------
  // Queue actions lived on list rows only; Home and Explore render cards.
  await goTo('Home')
  await sleep(900)
  // Two things make this fiddly, and both are about the page, not the menu.
  // Not every card on Home is a track — the playlists shelf has nothing to
  // queue — so the artwork that answers has to be looked for. And every play
  // the radio session above records fires libraryChanged, which refetches the
  // shelves and remounts the card the menu was just opened on: playback is
  // stopped and the shelf left to settle first, or the check races a re-render.
  const wasPlaying = await evalUI(`
    const playing = window.__store.getState().playing
    window.__store.setState({ playing: false })
    return playing
  `)
  // A track card is TrackRow's wrapper around ui.tsx's Card, so it is the
  // .shrink-0 that has Card's own .w-40.shrink-0 as a child — which is what
  // tells a queueable track apart from the playlist cards and the gradient
  // tiles beside it, both of which are also .shrink-0.
  const cardMenu = await evalUI(`
    const wrappers = () => [...document.querySelectorAll('main div.shrink-0:has(> div.w-40.shrink-0)')]
    let last = -1
    for (let i = 0; i < 20; i++) {
      const now = wrappers().length
      if (now > 0 && now === last) break
      last = now
      await new Promise(r => setTimeout(r, 400))
    }

    const cards = wrappers()
    const menuItems = () => [...document.querySelectorAll('button')].map(b => b.textContent.trim())
    for (const [i, card] of cards.entries()) {
      const rect = card.getBoundingClientRect()
      card.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, button: 2, clientX: rect.left + 8, clientY: rect.top + 8
      }))
      await new Promise(r => setTimeout(r, 250))
      const items = menuItems()
      if (items.includes('Play next') && items.includes('Add to queue')) {
        return { cards: cards.length, card: i, hasNext: true, hasQueue: true }
      }
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      await new Promise(r => setTimeout(r, 120))
    }
    return { cards: cards.length, card: -1, hasNext: false, hasQueue: false, items: menuItems().slice(0, 8) }
  `)
  // Handed back exactly as found: the media-key checks below expect a track
  // still playing.
  await evalUI(`window.__store.setState({ playing: ${Boolean(wasPlaying)} }); return true`)
  check(
    'right-clicking a shelf card offers the same queue actions as a row',
    cardMenu.hasNext && cardMenu.hasQueue,
    JSON.stringify(cardMenu)
  )
  await evalUI(
    "document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); return true"
  )
  await sleep(300)

  // ---- settings: the parts main owns -------------------------------------
  const version = await evalUI('return await window.api.settings.version()')
  check('the app reports its version', /^\d+\.\d+\.\d+/.test(version), version)

  // Deliberately read-only: setting it would write a real login item on the
  // machine running the suite, pointing at the binary driving it.
  const startup = await evalUI('return await window.api.settings.launchOnStartup()')
  check(
    'launch-on-startup reports whether the platform supports it',
    typeof startup.enabled === 'boolean' && startup.supported === (process.platform !== 'linux'),
    JSON.stringify(startup)
  )

  const tray = await evalUI(`
    const before = await window.api.settings.minimizeToTray()
    const off = await window.api.settings.setMinimizeToTray(false)
    const readBack = await window.api.settings.minimizeToTray()
    await window.api.settings.setMinimizeToTray(before)
    return { before, off, readBack, restored: await window.api.settings.minimizeToTray() }
  `)
  check(
    'minimize-to-tray round trips and defaults to on',
    tray.before === true && tray.off === false && tray.readBack === false && tray.restored === true,
    JSON.stringify(tray)
  )

  // ---- backup and restore ------------------------------------------------
  // Both sit behind native dialogs, so the dialogs are stubbed in the main
  // process. relaunch and quit are stubbed too, or a successful restore would
  // take the app out from under the rest of the run.
  const backupPath = join(userData, 'backup-under-test.db')
  const junkPath = join(userData, 'not-a-library.db')
  await evalMain(`
    const { dialog, app } = require('electron')
    dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: ${JSON.stringify(backupPath)} })
    global.__relaunched = 0
    app.relaunch = () => { global.__relaunched++ }
    app.quit = () => {}
    return true
  `)

  const wrote = await evalUI('return await window.api.settings.backup()')
  check('backup wrote the file the dialog named', wrote === backupPath, String(wrote))
  const backupFile = await evalMain(`
    const { statSync, readFileSync } = require('fs')
    const path = ${JSON.stringify(backupPath)}
    // Every SQLite file opens with this exact string, so a copy that is not one
    // is caught here rather than at the user's next restore.
    return { size: statSync(path).size, header: readFileSync(path).subarray(0, 15).toString() }
  `)
  check(
    'the backup is a real SQLite database',
    backupFile.header === 'SQLite format 3' && backupFile.size > 20_000,
    JSON.stringify(backupFile)
  )

  // A file that is not a library must be refused before the live one is moved.
  await evalMain(`
    const { writeFileSync } = require('fs')
    const { dialog } = require('electron')
    writeFileSync(${JSON.stringify(junkPath)}, 'this is not a database')
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [${JSON.stringify(junkPath)}] })
    return true
  `)
  const rejection = await evalUI(`
    try {
      await window.api.settings.restore()
      return 'it accepted a junk file'
    } catch (err) {
      return String((err && err.message) || err)
    }
  `)
  check(
    'restore refuses a file that is not a library',
    /library|backup/i.test(rejection),
    rejection
  )
  check(
    'and it refused before touching the live database',
    await evalMain(
      'const { existsSync } = require("fs");' +
        `const live = ${JSON.stringify(dbUnderTest)};` +
        'return existsSync(live) && !existsSync(live + ".bak")'
    )
  )

  // Now the real thing, from the backup taken above.
  await evalMain(`
    const { dialog } = require('electron')
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [${JSON.stringify(backupPath)}] })
    return true
  `)
  const restored = await evalUI('return await window.api.settings.restore()')
  check('restore reports success', restored === true, String(restored))
  const afterRestore = await evalMain(`
    const { existsSync, statSync } = require('fs')
    const live = ${JSON.stringify(dbUnderTest)}
    return {
      relaunched: global.__relaunched,
      live: existsSync(live) && statSync(live).size,
      keptOld: existsSync(live + '.bak'),
      journalGone: !existsSync(live + '-wal')
    }
  `)
  check(
    'the library was replaced, the old one kept, and its journal cleared',
    afterRestore.live > 20_000 && afterRestore.keptOld && afterRestore.journalGone,
    JSON.stringify(afterRestore)
  )
  check(
    'restore relaunches, since the old handle is only released on exit',
    afterRestore.relaunched === 1,
    JSON.stringify(afterRestore)
  )

  // ---- the settings page --------------------------------------------------
  await goTo('Settings')
  await sleep(900)
  const sections = await evalUI(`
    const text = document.querySelector('main').innerText.toLowerCase()
    return ['appearance', 'playback', 'library & storage', 'general'].filter(s => text.includes(s))
  `)
  check(
    'the settings page is built, not a placeholder',
    sections.length === 4,
    JSON.stringify(sections)
  )
  check(
    'it shows the app version',
    await evalUI(`return /\\d+\\.\\d+\\.\\d+/.test(document.querySelector('main').innerText)`)
  )

  /** Reads the value the whole palette actually resolves to right now. */
  const paintedBackground = () =>
    evalUI(`
      const rgb = getComputedStyle(document.body).backgroundColor.match(/\\d+/g).map(Number)
      return { rgb, mean: (rgb[0] + rgb[1] + rgb[2]) / 3 }
    `)
  const dark = await paintedBackground()

  // Clicking Light must repaint, not just set an attribute: an attribute with
  // no matching CSS would leave the app dark and the page claiming otherwise.
  const light = await evalUI(`
    const group = [...document.querySelectorAll('[role=group]')].find(g => g.getAttribute('aria-label') === 'Theme')
    const b = [...group.querySelectorAll('button')].find(b => b.textContent.trim() === 'Light')
    b.click()
    await new Promise(r => setTimeout(r, 300))
    const rgb = getComputedStyle(document.body).backgroundColor.match(/\\d+/g).map(Number)
    return { theme: document.documentElement.dataset.theme, rgb, mean: (rgb[0] + rgb[1] + rgb[2]) / 3 }
  `)
  check('choosing Light marks the document', light.theme === 'light', JSON.stringify(light))
  check(
    'and the app actually repaints light',
    light.mean > 200 && dark.mean < 40,
    `dark ${JSON.stringify(dark.rgb)} -> light ${JSON.stringify(light.rgb)}`
  )
  // The warm greyscale is the whole point of the palette: a light mode that
  // came out neutral or cool would mean the tokens were inverted, not designed.
  check(
    'the light greyscale stays warm',
    light.rgb[0] >= light.rgb[1] && light.rgb[1] >= light.rgb[2],
    JSON.stringify(light.rgb)
  )

  await goTo('Home')
  await sleep(900)
  await shot('17-home-light')
  await goTo('Settings')
  await sleep(700)

  const accent = await evalUI(`
    const ember = () => getComputedStyle(document.documentElement).getPropertyValue('--color-ember').trim()
    const before = ember()
    const group = [...document.querySelectorAll('[role=group]')].find(g => g.getAttribute('aria-label') === 'Accent')
    const swatches = [...group.querySelectorAll('button')]
    swatches[swatches.length - 1].click()
    await new Promise(r => setTimeout(r, 300))
    return { before, after: ember(), accent: document.documentElement.dataset.accent, count: swatches.length }
  `)
  check('four accents are offered', accent.count === 4, String(accent.count))
  check(
    'picking one repaints the accent token',
    Boolean(accent.accent) && accent.after !== '' && accent.after !== accent.before,
    JSON.stringify(accent)
  )

  // Put it back the way it was found, so the shots that follow match the rest.
  const restoredLook = await evalUI(`
    const themes = [...document.querySelectorAll('[role=group]')].find(g => g.getAttribute('aria-label') === 'Theme')
    ;[...themes.querySelectorAll('button')].find(b => b.textContent.trim() === 'Dark').click()
    // A frame apart on purpose: clicked in the same tick, the accent handler
    // still holds the previous theme and writes it back over this one.
    await new Promise(r => setTimeout(r, 300))
    const accents = [...document.querySelectorAll('[role=group]')].find(g => g.getAttribute('aria-label') === 'Accent')
    accents.querySelector('button').click()
    await new Promise(r => setTimeout(r, 300))
    return {
      theme: document.documentElement.dataset.theme,
      accent: document.documentElement.dataset.accent,
      stored: [localStorage.getItem('symus.theme'), localStorage.getItem('symus.accent')]
    }
  `)
  check(
    'the choice is persisted, not just applied',
    restoredLook.stored[0] === 'dark' && restoredLook.stored[1] === restoredLook.accent,
    JSON.stringify(restoredLook)
  )
  await shot('18-settings')

  /** Drives a native range input the way React expects to hear about it. */
  const setRange = (id, value) => `
    const el = document.getElementById(${JSON.stringify(id)})
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, ${JSON.stringify(String(value))})
    el.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 200))
  `

  // Crossfade had no control at all until now: the engine read a value nothing
  // could set, so it was always zero.
  const crossfade = await evalUI(`
    ${setRange('set-crossfade', 6)}
    return { store: window.__store.getState().crossfade, stored: localStorage.getItem('symus.crossfade') }
  `)
  check(
    'the crossfade slider reaches the audio engine and persists',
    crossfade.store === 6 && crossfade.stored === '6',
    JSON.stringify(crossfade)
  )
  await evalUI(`${setRange('set-crossfade', 0)} return true`)

  const volume = await evalUI(`
    ${setRange('set-volume', 0.4)}
    return { store: window.__store.getState().volume, stored: localStorage.getItem('symus.volume') }
  `)
  check(
    'volume now survives a launch',
    Math.abs(volume.store - 0.4) < 0.001 && Number(volume.stored) === 0.4,
    JSON.stringify(volume)
  )
  await evalUI(`${setRange('set-volume', 1)} return true`)

  const historyButton = await evalUI(`
    await window.api.searchHistory.record('settings page test')
    const before = (await window.api.searchHistory.recent()).length
    const rows = [...document.querySelectorAll('main button')]
    const b = rows.find(b => b.textContent.trim() === 'Clear')
    if (!b) return { found: false }
    b.click()
    await new Promise(r => setTimeout(r, 600))
    return { found: true, before, after: (await window.api.searchHistory.recent()).length }
  `)
  check(
    'Clear empties the search history from here',
    historyButton.found && historyButton.before > 0 && historyButton.after === 0,
    JSON.stringify(historyButton)
  )

  // The dialogs are still stubbed from the backup checks above, so this proves
  // the button is wired to the same path those verified.
  const backupButton = await evalUI(`
    const b = [...document.querySelectorAll('main button')].find(b => b.textContent.trim().startsWith('Back up'))
    if (!b) return { found: false }
    b.click()
    await new Promise(r => setTimeout(r, 2500))
    return { found: true, toast: document.body.innerText.includes('Backed up') || document.body.innerText.includes('backup') }
  `)
  check('the Back up button runs the backup', backupButton.found, JSON.stringify(backupButton))

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
