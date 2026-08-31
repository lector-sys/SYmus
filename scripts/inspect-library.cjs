// Prints what is actually in the library database, for diagnosing why a Home
// row is empty. Read-only.
//
//   node scripts/inspect-library.cjs
const { app, dialog } = require('electron')
const { join } = require('node:path')

app.whenReady().then(() => {
  try {
    const Database = require('better-sqlite3')
    const file =
      process.argv.find((a) => a.startsWith('--db='))?.slice(5) ??
      join(app.getPath('appData'), 'symus-desktop', 'symus.db')
    console.log('DB:', file)

    const db = new Database(file, { readonly: true })
    const q = (s) => {
      try {
        return db.prepare(s).all()
      } catch (e) {
        return [{ ERR: e.message }]
      }
    }
    const show = (label, rows) => console.log(`${label}: ${JSON.stringify(rows)}`)

    show('tables', q("SELECT name FROM sqlite_master WHERE type='table'").map((r) => r.name))
    show('migrations', q('SELECT name FROM _migrations').map((r) => r.name))
    show(
      'counts',
      q(`SELECT
        (SELECT COUNT(*) FROM Track) tracks,
        (SELECT COUNT(*) FROM "Like") likes,
        (SELECT COUNT(*) FROM HistoryEntry) history,
        (SELECT COUNT(*) FROM Playlist) playlists,
        (SELECT COUNT(*) FROM PlaylistTrack) playlistTracks`)[0]
    )
    show('genres', q('SELECT genre, COUNT(*) n FROM Track GROUP BY genre ORDER BY n DESC'))
    show(
      'untagged sample',
      q('SELECT title, artist FROM Track WHERE genre IS NULL LIMIT 8').map((r) => r.title)
    )
  } catch (err) {
    console.log('FAILED:', err.message)
  }
  // dialog is imported only so an unexpected throw cannot pop a modal that
  // blocks a non-interactive run.
  void dialog
  app.exit(0)
})
