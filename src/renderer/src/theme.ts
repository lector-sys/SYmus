/**
 * Theme selection. The palette itself lives in assets/main.css; this file only
 * decides which of its `data-theme` / `data-accent` branches the document is
 * on, so nothing here needs to know a single hex value.
 */

export type ThemeMode = 'light' | 'dark' | 'system'

export type Accent = 'classic' | 'plasma' | 'halide' | 'phosphor'

/**
 * The swatch is the accent's dark-theme ember, duplicated from main.css on
 * purpose: it lets the Settings page draw the dots without importing the
 * palette or reading computed styles off a hidden element, and a preview dot
 * that shows the current theme's variant would make the four options look
 * nearly identical in light mode.
 */
export const ACCENTS: { id: Accent; label: string; swatch: string }[] = [
  { id: 'classic', label: 'Classic', swatch: '#ff7a45' },
  { id: 'plasma', label: 'Plasma', swatch: '#b98cff' },
  { id: 'halide', label: 'Halide', swatch: '#3fd2c7' },
  { id: 'phosphor', label: 'Phosphor', swatch: '#5fd97e' }
]

const MODE_KEY = 'symus.theme'
const ACCENT_KEY = 'symus.accent'

/**
 * Guarded the same way store.ts guards its own reads: this module is reachable
 * from the node test runner, where there is no localStorage and an unguarded
 * read throws at import time and takes every test that touches it down.
 */
const read = (key: string): string | null => {
  try {
    return globalThis.localStorage?.getItem(key) ?? null
  } catch {
    return null
  }
}

const write = (key: string, value: string): void => {
  try {
    globalThis.localStorage?.setItem(key, value)
  } catch {
    /* no storage here; the choice simply does not persist */
  }
}

/**
 * Stored values are validated rather than cast. They come from a disk file the
 * user can edit and from older builds that may have written ids this one no
 * longer has; an unrecognised accent would otherwise put the document on a
 * `data-accent` with no matching rule, leaving Classic's tokens under a
 * selector the Settings page shows as selected.
 */
export function loadTheme(): { mode: ThemeMode; accent: Accent } {
  const mode = read(MODE_KEY)
  const accent = read(ACCENT_KEY)
  return {
    mode: mode === 'light' || mode === 'dark' || mode === 'system' ? mode : 'system',
    accent: ACCENTS.some((a) => a.id === accent) ? (accent as Accent) : 'classic'
  }
}

let mode: ThemeMode = 'system'
let watch: MediaQueryList | null = null

const paint = (): void => {
  document.documentElement.dataset.theme =
    mode === 'system' ? (watch?.matches ? 'dark' : 'light') : mode
}

export function applyTheme(next: ThemeMode, accent: Accent): void {
  mode = next
  write(MODE_KEY, next)
  write(ACCENT_KEY, accent)
  document.documentElement.dataset.accent = accent

  // Attached once, not once per call. The Settings page calls this on every
  // click, and a listener per click would leave a stack of them all writing
  // data-theme the next time the OS flipped — including ones closing over a
  // mode the user has since changed.
  if (!watch) {
    watch = globalThis.matchMedia?.('(prefers-color-scheme: dark)') ?? null
    // System means *keeps* following the OS, not "matched it once at boot".
    watch?.addEventListener('change', () => {
      if (mode === 'system') paint()
    })
  }
  paint()
}
