import { invoke } from '../invoke'

/**
 * Renderer-facing API for the Settings page. Owned by that feature alone.
 */
export const settingsApi = {
  version: () => invoke<string>('settings:version'),

  /**
   * `supported` is false on Linux, where Electron has no login-item API — the
   * page disables the control rather than showing a toggle that does nothing.
   */
  launchOnStartup: () =>
    invoke<{ supported: boolean; enabled: boolean }>('settings:launchOnStartup'),
  /** Resolves to the state actually in effect, which the OS may refuse to change. */
  setLaunchOnStartup: (on: boolean) => invoke<boolean>('settings:setLaunchOnStartup', on),

  minimizeToTray: () => invoke<boolean>('settings:minimizeToTray'),
  setMinimizeToTray: (on: boolean) => invoke<boolean>('settings:setMinimizeToTray', on),

  /** Writes a consistent copy of the library. Resolves to the path, or null if cancelled. */
  backup: () => invoke<string | null>('settings:backup'),
  /** Swaps in a backup and relaunches. Resolves false if cancelled; rejects if the file is not a library. */
  restore: () => invoke<boolean>('settings:restore')
}
