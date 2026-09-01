import { useEffect, useState } from 'react'
import { RotateCcw, Save, Trash2 } from 'lucide-react'
import type { Repeat } from '../store'
import { usePlayer } from '../store'
import { useLibrary } from '../useLibrary'
import { ACCENTS, applyTheme, loadTheme, type Accent, type ThemeMode } from '../theme'
import { Eyebrow, PageTitle } from '../ui'

/**
 * Copied from Downloaded.tsx rather than shared. The note there is right — this
 * belongs in ui.tsx — but moving it is a change to a file this page does not own.
 */
function formatBytes(bytes: number): string {
  if (!bytes) return '0 MB'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const power = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** power
  return `${value.toFixed(power <= 1 ? 0 : 1)} ${units[power]}`
}

/**
 * Read off the store rather than through the hook, so the async handlers below
 * need no dependency on a render-scoped binding.
 */
const fail = (err: unknown): void =>
  usePlayer.getState().toast(err instanceof Error ? err.message : String(err))

const pill =
  'inline-flex items-center gap-1.5 rounded-full border border-line px-3.5 py-1.5 text-[12px] font-medium transition-colors hover:border-dust hover:bg-raised disabled:opacity-30 disabled:hover:border-line disabled:hover:bg-transparent'

/** One setting: what it is on the left, the control that changes it on the right. */
function Row({
  label,
  hint,
  control,
  htmlFor
}: {
  label: string
  hint?: string
  control: React.ReactNode
  htmlFor?: string
}): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-6 border-b border-line py-4 last:border-0">
      <div className="min-w-0">
        {/* A grouped control (segmented buttons, swatches) carries its own
            aria-label, so there is nothing for `for` to point at — and a <label>
            with no control is exactly what screen readers report as broken. */}
        {htmlFor ? (
          <label htmlFor={htmlFor} className="cursor-pointer text-[13px] font-medium">
            {label}
          </label>
        ) : (
          <p className="text-[13px] font-medium">{label}</p>
        )}
        {hint && <p className="mt-1 max-w-md text-xs leading-relaxed text-ash">{hint}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-3 pt-0.5">{control}</div>
    </div>
  )
}

/** A row of mutually exclusive choices. aria-pressed is what carries the state. */
function Segmented<T extends string>({
  label,
  value,
  options,
  onChange
}: {
  label: string
  value: T
  options: { id: T; label: string }[]
  onChange: (id: T) => void
}): React.JSX.Element {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex items-center gap-1 rounded-full bg-raised p-1"
    >
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
          className={`rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${
            value === o.id ? 'bg-ember text-ink' : 'text-ash hover:text-chalk'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/**
 * A checkbox whose state may still be in flight. `null` renders a placeholder
 * instead of an unchecked box: a toggle that shows "off" and flips to "on" a
 * beat later reads as the app having forgotten the setting.
 */
function Toggle({
  id,
  checked,
  disabled,
  onChange
}: {
  id: string
  checked: boolean | null
  disabled?: boolean
  onChange: (on: boolean) => void
}): React.JSX.Element {
  if (checked === null) return <span className="font-mono text-xs text-ash">…</span>
  return (
    <input
      id={id}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      className="h-4 w-4 shrink-0 cursor-pointer accent-ember disabled:cursor-not-allowed disabled:opacity-30"
    />
  )
}

export default function Settings(): React.JSX.Element {
  const s = usePlayer()
  const [theme, setTheme] = useState(loadTheme)

  const { data: cache, loading: cacheLoading } = useLibrary(() => window.api.offline.summary(), {
    count: 0,
    bytes: 0
  })

  // null until main answers. See the note on Toggle for why that matters.
  const [startup, setStartup] = useState<{ supported: boolean; enabled: boolean } | null>(null)
  const [tray, setTray] = useState<boolean | null>(null)
  const [version, setVersion] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState('')

  useEffect(() => {
    window.api.settings.launchOnStartup().then(setStartup).catch(fail)
    window.api.settings.minimizeToTray().then(setTray).catch(fail)
    window.api.settings.version().then(setVersion).catch(fail)
  }, [])

  /** One busy flag and one error path for every button that talks to main. */
  const run = async (id: string, work: () => Promise<void>): Promise<void> => {
    setBusy(id)
    try {
      await work()
    } catch (err) {
      fail(err)
    } finally {
      setBusy('')
    }
  }

  const pickTheme = (mode: ThemeMode): void => {
    applyTheme(mode, theme.accent)
    setTheme({ ...theme, mode })
  }

  const pickAccent = (accent: Accent): void => {
    applyTheme(theme.mode, accent)
    setTheme({ ...theme, accent })
  }

  return (
    <div className="view-enter px-6 py-6">
      <div className="max-w-3xl">
        <div className="mb-8">
          <PageTitle sub="Every change here takes effect immediately">Settings</PageTitle>
        </div>

        <section className="mb-8">
          <Eyebrow>Appearance</Eyebrow>
          <div className="rounded-xl bg-panel px-4">
            <Row
              label="Theme"
              hint="System follows whatever your desktop is set to, and keeps following it."
              control={
                <Segmented
                  label="Theme"
                  value={theme.mode}
                  onChange={pickTheme}
                  options={[
                    { id: 'light', label: 'Light' },
                    { id: 'dark', label: 'Dark' },
                    { id: 'system', label: 'System' }
                  ]}
                />
              }
            />
            <Row
              label="Accent"
              hint="The one colour the app spends: playing tracks, primary buttons, focus rings."
              control={
                <div role="group" aria-label="Accent" className="flex items-center gap-2.5">
                  {ACCENTS.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => pickAccent(a.id)}
                      aria-pressed={theme.accent === a.id}
                      aria-label={a.label}
                      title={a.label}
                      style={{ background: a.swatch }}
                      className={`h-6 w-6 rounded-full ring-offset-2 ring-offset-panel transition-transform hover:scale-110 ${
                        theme.accent === a.id ? 'ring-2 ring-chalk' : 'ring-0'
                      }`}
                    />
                  ))}
                </div>
              }
            />
          </div>
        </section>

        <section className="mb-8">
          <Eyebrow>Playback</Eyebrow>
          <div className="rounded-xl bg-panel px-4">
            <Row
              htmlFor="set-volume"
              label="Volume"
              hint="The same slider as the one in the player bar — where you leave it is where it starts next time."
              control={
                <>
                  <input
                    id="set-volume"
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={s.volume}
                    onChange={(e) => s.setVolume(Number(e.target.value))}
                    className="w-44 cursor-pointer accent-ember"
                  />
                  <span className="w-9 text-right font-mono text-[11px] tabular-nums text-ash">
                    {Math.round(s.volume * 100)}%
                  </span>
                </>
              }
            />
            <Row
              htmlFor="set-shuffle"
              label="Shuffle"
              hint="Remembered across restarts, so a shuffled library stays shuffled."
              control={
                <Toggle id="set-shuffle" checked={s.shuffle} onChange={() => s.toggleShuffle()} />
              }
            />
            <Row
              label="Repeat"
              hint="All loops the queue; One repeats the track that is playing."
              control={
                <Segmented
                  label="Repeat"
                  value={s.repeat}
                  onChange={(r: Repeat) => s.setRepeat(r)}
                  options={[
                    { id: 'off', label: 'Off' },
                    { id: 'all', label: 'All' },
                    { id: 'one', label: 'One' }
                  ]}
                />
              }
            />
            <Row
              htmlFor="set-crossfade"
              label="Crossfade"
              hint="Seconds of overlap as one track hands over to the next. Zero turns it off."
              control={
                <>
                  <input
                    id="set-crossfade"
                    type="range"
                    min={0}
                    max={12}
                    step={1}
                    value={s.crossfade}
                    onChange={(e) => s.setCrossfade(Number(e.target.value))}
                    className="w-44 cursor-pointer accent-ember"
                  />
                  <span className="w-9 text-right font-mono text-[11px] tabular-nums text-ash">
                    {s.crossfade ? `${s.crossfade}s` : 'Off'}
                  </span>
                </>
              }
            />
            <Row
              htmlFor="set-autoplay"
              label="Autoplay"
              hint="When the queue runs dry, keep going with tracks similar to the last one."
              control={<Toggle id="set-autoplay" checked={s.autoplay} onChange={s.setAutoplay} />}
            />
          </div>
        </section>

        <section className="mb-8">
          <Eyebrow>Library &amp; storage</Eyebrow>
          <div className="rounded-xl bg-panel px-4">
            <Row
              label="Cached audio"
              hint="Copies of tracks you saved for offline, kept on disk. Clearing them frees the space; nothing leaves your library."
              control={
                <>
                  <span className="font-mono text-[11px] tabular-nums text-ash">
                    {cacheLoading
                      ? '…'
                      : `${cache.count} track${cache.count === 1 ? '' : 's'} · ${formatBytes(cache.bytes)}`}
                  </span>
                  <button
                    onClick={() =>
                      run('cache', async () => {
                        const dropped = await window.api.offline.clearAll()
                        s.toast(dropped ? `Cleared ${dropped} cached tracks` : 'Nothing was cached')
                        s.libraryChanged()
                      })
                    }
                    disabled={busy === 'cache' || cacheLoading || !cache.count}
                    className={pill}
                  >
                    <Trash2 size={12} />
                    {busy === 'cache' ? 'Clearing' : 'Clear all'}
                  </button>
                </>
              }
            />
            <Row
              label="Search history"
              hint="The recent searches offered under the search box."
              control={
                <button
                  onClick={() =>
                    run('history', async () => {
                      await window.api.searchHistory.clear()
                      s.toast('Search history cleared')
                    })
                  }
                  disabled={busy === 'history'}
                  className={pill}
                >
                  <Trash2 size={12} />
                  {busy === 'history' ? 'Clearing' : 'Clear'}
                </button>
              }
            />
            <Row
              label="Back up the library"
              hint="Writes your tracks, playlists, likes and history to a single file you choose. Cached audio is not included."
              control={
                <button
                  onClick={() =>
                    run('backup', async () => {
                      const path = await window.api.settings.backup()
                      // null is the file dialog being dismissed, not a failure —
                      // a cancelled backup must not be announced as a problem.
                      if (path) s.toast(`Library backed up to ${path}`)
                    })
                  }
                  disabled={busy === 'backup'}
                  className={pill}
                >
                  <Save size={12} />
                  {busy === 'backup' ? 'Backing up' : 'Back up…'}
                </button>
              }
            />
            <Row
              label="Restore from a backup"
              hint="Replaces your entire library with the contents of a backup file, then relaunches SYmuS. Everything added since that backup is lost. This is the only setting here that does not simply apply in place."
              control={
                confirming ? (
                  <>
                    <button onClick={() => setConfirming(false)} className={pill}>
                      Cancel
                    </button>
                    <button
                      onClick={() =>
                        run('restore', async () => {
                          const ok = await window.api.settings.restore()
                          // false is a dismissed file dialog; on success the main
                          // process is already relaunching under this toast.
                          if (ok) s.toast('Library restored — relaunching…')
                          setConfirming(false)
                        })
                      }
                      disabled={busy === 'restore'}
                      className="inline-flex items-center gap-1.5 rounded-full bg-forge px-3.5 py-1.5 text-[12px] font-semibold text-chalk transition-opacity hover:opacity-90 disabled:opacity-40"
                    >
                      {busy === 'restore' ? 'Restoring…' : 'Replace my library'}
                    </button>
                  </>
                ) : (
                  <button onClick={() => setConfirming(true)} className={pill}>
                    <RotateCcw size={12} />
                    Restore…
                  </button>
                )
              }
            />
          </div>
        </section>

        <section className="mb-4">
          <Eyebrow>General</Eyebrow>
          <div className="rounded-xl bg-panel px-4">
            <Row
              htmlFor="set-startup"
              label="Launch on startup"
              hint={
                startup && !startup.supported
                  ? 'Unavailable on this system — Linux desktops give Electron no login-item API to register with.'
                  : 'Open SYmuS automatically when you sign in.'
              }
              control={
                <Toggle
                  id="set-startup"
                  checked={startup ? startup.enabled : null}
                  disabled={!startup?.supported}
                  onChange={(on) =>
                    // The reply is the state actually in effect: the OS can refuse,
                    // and the checkbox should follow the machine, not the click.
                    window.api.settings
                      .setLaunchOnStartup(on)
                      .then((enabled) => setStartup((prev) => prev && { ...prev, enabled }))
                      .catch(fail)
                  }
                />
              }
            />
            <Row
              htmlFor="set-tray"
              label="Minimize to tray"
              hint="Closing the window keeps SYmuS playing in the tray instead of quitting it."
              control={
                <Toggle
                  id="set-tray"
                  checked={tray}
                  onChange={(on) =>
                    window.api.settings.setMinimizeToTray(on).then(setTray).catch(fail)
                  }
                />
              }
            />
            <Row
              label="Version"
              hint="SYmuS updates when you install a new build."
              control={
                <span className="font-mono text-[11px] tabular-nums text-ash">
                  {version || '…'}
                </span>
              }
            />
          </div>
        </section>
      </div>
    </div>
  )
}
