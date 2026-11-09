import type { CostEstimate } from './models'
import type {
  AudioSource,
  Meeting,
  MeetingDetail,
  SegmentPayload,
  Settings,
  SettingsUpdate,
  TranscriptLine
} from './types'

/**
 * Contract of the preload → renderer bridge.
 *
 * Declared here, not in the preload, so the renderer can type `window.yogurt`
 * without importing `electron` — which would drag Node's globals into the web
 * project.
 */
export interface YogurtApi {
  settings: {
    get: () => Promise<Settings>
    update: (update: SettingsUpdate) => Promise<Settings>
    testKey: () => Promise<{ ok: boolean; error?: string }>
  }

  meetings: {
    start: (title: string) => Promise<Meeting>
    addSegment: (payload: SegmentPayload) => Promise<void>
    /** `elapsedMs` stamps the new lines; `null` outside a recording. */
    saveNotes: (id: string, notes: string, elapsedMs: number | null) => Promise<void>
    finish: (id: string, durationMs: number) => Promise<Meeting | null>
    list: () => Promise<Meeting[]>
    get: (id: string) => Promise<MeetingDetail | null>
    rename: (id: string, title: string) => Promise<Meeting | null>
    remove: (id: string) => Promise<void>
    removeAudio: (id: string) => Promise<void>
    /** Approximate cost of the actions that resend data to the API. */
    costEstimate: (id: string) => Promise<CostEstimate | null>
    regenerate: (id: string) => Promise<Meeting | null>
    retranscribe: (id: string) => Promise<Meeting | null>
    export: (
      id: string,
      kind: 'summary' | 'full'
    ) => Promise<{ saved: boolean; filePath?: string }>
    reveal: (id: string) => Promise<void>
    /** Opens the full error and per-block problems in a .txt, outside the app. */
    openErrorReport: (id: string) => Promise<void>
    /** Raw audio of a segment. */
    readSegment: (
      id: string,
      index: number,
      source?: AudioSource
    ) => Promise<Uint8Array | null>
    /**
     * Names several speaker labels in this meeting at once; `null` clears.
     *
     * Batched because that's the real volume — a 45-min meeting produced 59
     * labels for 3 people — and because a single write of `meta.json` avoids
     * half-applied state.
     */
    setSpeakerNames: (
      id: string,
      labelKeys: string[],
      name: string | null
    ) => Promise<Meeting | null>
  }

  app: {
    /**
     * Installed version. Exists because `signAndEditExecutable: false` leaves
     * the .exe without version metadata — without this, a tester has no way to
     * tell which build reproduced the bug they're reporting.
     */
    version: () => Promise<string>
    openDataFolder: () => Promise<void>
    /**
     * Mirrors the recording state in the main process, which uses it for the
     * tray icon and tooltip, to block the machine from sleeping, and to confirm
     * before actually quitting.
     */
    setRecordingState: (state: {
      recording: boolean
      paused: boolean
      elapsedMs: number
    }) => Promise<void>
  }

  events: {
    onMeetingUpdated: (cb: (meeting: Meeting) => void) => () => void
    onTranscript: (cb: (id: string, lines: TranscriptLine[]) => void) => () => void
    onSegmentError: (cb: (id: string, index: number, message: string) => void) => () => void
    /** Another app started using the microphone — maybe a meeting is starting. */
    onSuggestStart: (cb: (apps: string[]) => void) => () => void
    /** Nobody is using the microphone anymore — maybe the meeting has ended. */
    onSuggestStop: (cb: () => void) => () => void
  }
}
