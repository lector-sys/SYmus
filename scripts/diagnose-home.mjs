// Runs the real library queries and the real Home render against a COPY of the
// user's actual database, so a diagnosis reflects real data rather than seeded
// happy-path data.
//
//   npm run build && node scripts/diagnose-home.mjs
import { spawn } from 'node:child_process'
import { copyFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import electron from 'electron'

const REAL_DB = join(process.env.APPDATA, 'symus-desktop', 'symus.db')
if (!existsSync(REAL_DB)) {
  console.error('No library at', REAL_DB)
  process.exit(1)
}

const dir = mkdtempSync(join(tmpdir(), 'symus-diag-'))
copyFileSync(REAL_DB, join(dir, 'symus.db'))
console.log('copied real library ->', dir)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function target(port, match) {
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

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl)
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = () => rej(new Error('cannot connect'))
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
  return (method, params = {}) =>
    new Promise((res, rej) => {
      const n = ++id
      pending.set(n, { res, rej })
      ws.send(JSON.stringify({ id: n, method, params }))
      setTimeout(() => pending.has(n) && rej(new Error(`${method} timed out`)), 60_000)
    })
}

const child = spawn(
  electron,
  ['.', '--remote-debugging-port=9333', '--inspect=9334', `--user-data-dir=${dir}`, '--no-sandbox'],
  { stdio: ['ignore', 'inherit', 'inherit'] }
)

try {
  const page = await target(9333, (t) => t.type === 'page' && !t.url.startsWith('devtools:'))
  const send = await connect(page.webSocketDebuggerUrl)
  const mainT = await target(9334, (t) => t.webSocketDebuggerUrl)
  const sendMain = await connect(mainT.webSocketDebuggerUrl)
  await send('Runtime.enable')
  await sendMain('Runtime.enable')

  await sendMain(
    'Runtime.evaluate',
    {
      expression:
        'const {BrowserWindow}=require("electron");const w=BrowserWindow.getAllWindows()[0];w.show();w.focus();',
      returnByValue: true
    }
  )

  const evalUI = async (expr) => {
    const r = await send('Runtime.evaluate', {
      expression: `(async () => { ${expr} })()`,
      awaitPromise: true,
      returnByValue: true
    })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
    return r.result.value
  }

  await sleep(3000)

  const data = await evalUI(`
    const [genres, recommended, recent, top, playlists, likes] = await Promise.all([
      window.api.lib.genres(),
      window.api.lib.recommended(16),
      window.api.lib.recent(16),
      window.api.lib.top(16),
      window.api.lib.playlists(),
      window.api.lib.likes()
    ])
    return {
      genres,
      recommendedCount: recommended.length,
      recommendedSample: recommended.slice(0, 3).map(t => ({ title: t.title.slice(0, 40), genre: t.genre, artist: t.artist })),
      recentCount: recent.length,
      topCount: top.length,
      playlistCount: playlists.length,
      likeCount: likes.length,
      likedGenres: likes.map(t => t.genre),
      likedArtists: likes.map(t => t.artist)
    }
  `)

  console.log('\n=== IPC returns (real code, real data) ===')
  for (const [k, v] of Object.entries(data)) console.log(` ${k}:`, JSON.stringify(v))

  const rows = await evalUI(
    'return [...document.querySelectorAll("h2")].map(h => h.textContent.trim())'
  )
  console.log('\n=== Home rows actually rendered ===')
  console.log(' ', JSON.stringify(rows))
} finally {
  child.kill()
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* temp dir; the OS will clear it */
  }
}
process.exit(0)
