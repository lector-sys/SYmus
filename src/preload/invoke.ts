import { ipcRenderer } from 'electron'

/**
 * ipcRenderer wraps a rejection as "Error invoking remote method 'x': Error: real
 * message". Every message from main is already written for a human, so unwrap it
 * once, here.
 *
 * Shared by the feature slices so each one can be owned by a single feature
 * without them all editing the same file.
 */
export async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  try {
    return (await ipcRenderer.invoke(channel, ...args)) as T
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(message.replace(/^Error invoking remote method '[^']*':\s*(Error:\s*)?/, ''))
  }
}
