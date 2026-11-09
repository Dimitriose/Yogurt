/**
 * State shared between the tray, the close handler and the IPC.
 *
 * Lives in its own module so `ipc` can write it without importing `index`,
 * which already imports `ipc` — and so the tray can observe it without knowing
 * about either.
 */

export interface RecordingState {
  recording: boolean
  paused: boolean
  /** Duration recorded so far, in ms. */
  elapsedMs: number
}

const IDLE: RecordingState = { recording: false, paused: false, elapsedMs: 0 }

let recordingState: RecordingState = IDLE
/** True only when quitting is intentional — closing the window just hides it. */
let quitting = false

const listeners = new Set<(state: RecordingState) => void>()

export function setRecordingState(next: RecordingState): void {
  recordingState = next
  for (const listener of listeners) listener(recordingState)
}

export function getRecordingState(): RecordingState {
  return recordingState
}

export function isRecording(): boolean {
  return recordingState.recording
}

/** Registers an observer and returns the function that removes it. */
export function onRecordingState(cb: (state: RecordingState) => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function setQuitting(value: boolean): void {
  quitting = value
}

export function isQuitting(): boolean {
  return quitting
}
