/** Types shared between main, preload and renderer. */

import type { NoteLine } from './notes'
import type { Lang, LanguagePref } from './i18n'

export type MeetingStatus =
  | 'recording'
  | 'transcribing'
  | 'summarizing'
  | 'ready'
  | 'error'

/** A meeting's metadata — what shows up in the library. */
export interface Meeting {
  id: string
  title: string
  /** ISO 8601. */
  createdAt: string
  /** ISO 8601, absent while the meeting is being recorded. */
  endedAt?: string
  durationMs: number
  status: MeetingStatus
  /** Error message when status === 'error'. */
  error?: string
  /** Language detected by Whisper (e.g. 'portuguese'). */
  language?: string
  /** Number of audio segments recorded. */
  segmentCount: number
  /** How many segments have come back from Whisper. */
  transcribedCount: number
  hasSummary: boolean
  /**
   * Start offset of each segment on the timeline, in ms. Needed to find which
   * audio file a transcript moment falls in — it's what makes it possible to
   * cut a speaker's reference clip.
   */
  segmentOffsetsMs?: number[]
  /** Whether this meeting was transcribed with diarization. */
  diarized?: boolean
  /** Distinct speaker labels found, per segment: `"0:A"`, `"0:B"`… */
  speakerLabels?: string[]
  /** Segments written to disk but not sent to the API because they were silent. */
  skippedSilent?: number
  /**
   * Audio measurement per segment and channel.
   *
   * Persisted because the first version computed the level and threw it away —
   * which made it impossible to explain, after the fact, why a recording with
   * the microphone muted got through the silence gate.
   */
  audioLevels?: SegmentAudioLevel[]
  /**
   * Names the user assigned **in this meeting**, from label to person:
   * `{ "0:A": "Pedro" }`.
   *
   * Kept separate from the transcript on purpose: the transcript stays as the
   * API returned it, and naming is a layer on top — reversible, and applicable
   * retroactively to the minutes without retranscribing. It's also what lets
   * the screen remember who you've already registered.
   */
  speakerNames?: Record<string, string>
  /**
   * Per-block problems that outlive the session.
   *
   * Persisted because the previous version only broadcast these warnings as
   * events, and the only listener was the recording screen: leaving it — or
   * reopening the app — wiped the information. In a long meeting that's exactly
   * when it matters, because the symptom (a transcript that ends before the
   * end) is indistinguishable from "the meeting ended early" without this
   * record.
   */
  blockIssues?: BlockIssue[]
}

/** A block that was truncated or failed, with the data needed to size the gap. */
export interface BlockIssue {
  index: number
  source?: AudioSource
  /**
   * `truncated`: the API answered 200 and the end of the block was missing.
   * `failed`: the request didn't come back.
   */
  kind: 'truncated' | 'failed'
  message: string
  /** Output tokens actually used, when the API reports them. */
  outputTokens?: number
  /** Last moment covered by the block and its duration, both in seconds. */
  coveredSec?: number
  durationSec?: number
}

export interface SegmentAudioLevel {
  index: number
  source: AudioSource
  /** Maximum RMS observed in the segment. */
  peak: number
  /** Estimated noise floor (median of the samples). */
  floor: number
  /** Time with energy above the floor, in ms. */
  activeMs: number
  /** Whether it was treated as silence and not sent to the API. */
  skipped: boolean
}

/** A transcript line, with offsets in seconds from the start of the meeting. */
export interface TranscriptLine {
  start: number
  end: number
  text: string
  /**
   * Speaker label, present only when diarization is on. Comes as a sequential
   * letter (`A`, `B`, …) when the speaker is unknown, or already as the name
   * when the API itself identifies them in the audio.
   *
   * Caution: anonymous labels are **per request**. The `A` of segment 1 is not
   * necessarily the `A` of segment 2 — see `segmentIndex`.
   */
  speaker?: string
  /** Source segment, needed to disambiguate anonymous labels. */
  segmentIndex?: number
  /**
   * Source capture channel. `mic` is always the user themselves — hence it is
   * labeled `SELF_SPEAKER` without depending on diarization.
   */
  source?: AudioSource
}

/** Capture channel. */
export type AudioSource = 'mic' | 'system'

/**
 * Fixed label of the microphone channel: it's always whoever is using the app.
 *
 * Stored as-is in `transcript.json` and compared against when reading it back,
 * so it is a data value, not UI text: changing it would orphan the lines of
 * meetings already on disk. Translate it at display time instead.
 */
export const SELF_SPEAKER = 'Eu'

/**
 * Fixed label of the system channel when diarization is off. Same rule as
 * `SELF_SPEAKER`: a stored data value, translated only at display time.
 */
export const OTHERS_SPEAKER = 'Outros'

/**
 * Segment length cap when diarization is on.
 *
 * `gpt-4o-transcribe-diarize` has 2,000 output tokens, and `diarized_json`
 * spends tokens on more than the text: each chunk carries `speaker`, `start`
 * and `end`. In a dense conversation, a 4-min block came close to the cap — and
 * the symptom of exceeding it is silently losing the end of the block. 3 min
 * leaves headroom.
 */
export const MAX_SEGMENT_MINUTES_DIARIZED = 3

/** Segment length cap without diarization, where only the 25 MB per-file limit matters. */
export const MAX_SEGMENT_MINUTES = 10

/** Useful range of the microphone meter, in dBFS. */
export const MIC_METER_FLOOR_DB = -60
export const MIC_THRESHOLD_MIN_DB = -60
export const MIC_THRESHOLD_MAX_DB = -12

/** -40 dBFS = 0.01 RMS, the fixed threshold that existed before it was adjustable. */
export const DEFAULT_MIC_THRESHOLD_DB = -40

/** Conversions between the user's scale (dB) and the measurement's (linear RMS). */
export function dbToRms(db: number): number {
  return Math.pow(10, db / 20)
}

export function rmsToDb(rms: number): number {
  return rms <= 0 ? MIC_METER_FLOOR_DB : Math.max(MIC_METER_FLOOR_DB, 20 * Math.log10(rms))
}

/** Full meeting, with content. */
export interface MeetingDetail extends Meeting {
  /** Raw notes typed by the user during the meeting (markdown). */
  notes: string
  /** The same notes, line by line, with the moment each was written. */
  noteLines: NoteLine[]
  transcript: TranscriptLine[]
  /** Enriched minutes generated by the model (markdown). */
  summary: string
}

export interface Settings {
  /** Never leaves the main process in plain text — the renderer only gets `hasApiKey`. */
  hasApiKey: boolean
  transcriptionModel: string
  summaryModel: string
  /**
   * Turns on speaker identification. Opt-in on purpose: it switches the
   * transcription model, and its pt-BR quality versus whisper-1 hasn't been
   * measured yet.
   */
  diarization: boolean
  diarizationModel: string
  /** Duration of each audio segment, in minutes. */
  segmentMinutes: number
  /**
   * Closing the window hides it in the tray instead of quitting the app. On by
   * default: closing by accident in the middle of a meeting costs the meeting.
   */
  closeToTray: boolean
  /** Whether the "closed, but still in the tray" notice has been shown. */
  trayHintShown: boolean
  /**
   * Detects when another app starts using the microphone and suggests starting
   * a recording; when it's released, suggests stopping. It suggests, never
   * decides on its own.
   */
  autoDetectMeetings: boolean
  captureSystemAudio: boolean
  captureMicrophone: boolean
  micGain: number
  systemGain: number
  /**
   * Microphone sensitivity cutoff, in dBFS. Sound below this doesn't count as
   * speech, and a segment without speech isn't sent to the API.
   *
   * In dB rather than linear RMS because that's what the user sees on the
   * meter: the linear scale squashes everything that matters near zero.
   * -40 dBFS equals 0.01 RMS, which was the previous fixed threshold.
   */
  micThresholdDb: number
  /** Extra instructions appended to the summarization prompt. */
  customInstructions: string
  /**
   * Tokens-per-minute cap of your OpenAI account, for the text model.
   *
   * Exists because this is the limit that breaks long meetings, and it belongs
   * to the *account*, not the model: a 98-min meeting failed with "Limit 30000,
   * Requested 31406" while gpt-4o's context window (128k) had plenty of room.
   * Knowing the cap, the app condenses the transcript before sending instead of
   * getting a 429 at the end of an hour and a half of recording.
   *
   * The value appears in the API's own error message, and the app adopts it
   * automatically when it finds it.
   */
  tpmLimit: number
  /** UI and minutes language. `auto` follows the OS locale. */
  language: LanguagePref
  /** `language` resolved against the OS locale by the main process. Read-only. */
  resolvedLanguage: Lang
}

export interface SettingsUpdate
  extends Partial<Omit<Settings, 'hasApiKey' | 'resolvedLanguage'>> {
  /** Plain text; the main process encrypts it before writing. */
  apiKey?: string
}

/** Payload of an audio segment sent from the renderer to the main process. */
export interface SegmentPayload {
  meetingId: string
  index: number
  startMs: number
  durationMs: number
  data: ArrayBuffer
  /** Source channel; written to a separate file and determines the speaker label. */
  source: AudioSource
  /**
   * Writes the file but doesn't call the API. Used when the channel was silent
   * during the segment: transcribing silence costs the same as transcribing
   * speech. The file stays on disk, so "Retranscribe" remains a way out.
   */
  skipTranscription?: boolean
  /** Audio measurement, persisted in `meta.json` for later auditing. */
  stats?: { peak: number; floor: number; activeMs: number; silent: boolean }
}

/** Label key used in `speakerNames`, stable across sessions. */
export function speakerLabelKey(
  segmentIndex: number | undefined,
  speaker: string
): string {
  return `${segmentIndex ?? 0}:${speaker}`
}

/** The API's anonymous labels are single uppercase letters (`A`, `B`, …). */
export function isAnonymousSpeaker(speaker: string): boolean {
  return /^[A-Z]$/.test(speaker)
}

export const DEFAULT_SETTINGS: Omit<Settings, 'hasApiKey' | 'resolvedLanguage'> = {
  language: 'auto',
  transcriptionModel: 'whisper-1',
  summaryModel: 'gpt-5.6-luna',
  diarization: false,
  diarizationModel: 'gpt-4o-transcribe-diarize',
  closeToTray: true,
  trayHintShown: false,
  autoDetectMeetings: true,
  segmentMinutes: 4,
  captureSystemAudio: true,
  captureMicrophone: true,
  micGain: 1,
  systemGain: 1,
  micThresholdDb: DEFAULT_MIC_THRESHOLD_DB,
  customInstructions: '',
  // See `shared/models.ts`. gpt-4o used to be the default and has only 30,000
  // TPM on the first tier — the limit that made a 98-min meeting's minutes
  // fail. luna has 200,000 on the same account.
  tpmLimit: 200_000
}
