import { friendlyError } from './apiErrors'
import { BrowserWindow } from 'electron'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type {
  AudioSource,
  BlockIssue,
  Meeting,
  SegmentPayload,
  TranscriptLine
} from '@shared/types'
import { OTHERS_SPEAKER, SELF_SPEAKER } from '@shared/types'
import { msgs } from '@shared/i18n'
import { mapWithLimit, TRANSCRIBE_CONCURRENCY } from './pool'
import * as store from './store'
import { getPublicSettings } from './settings'
import { transcribeFile, summarizeMeeting, generateTitle } from './openai'
import { filterHallucinations } from './hallucination'
import { dedupeChannels } from '@shared/dedupe'
import { alignNoteStamps } from '@shared/notes'

/**
 * Label for the system channel when diarization is off. Stored as the stable
 * `OTHERS_SPEAKER` value; `resolveSpeaker` translates it for display.
 */
function othersSpeaker(): string {
  return OTHERS_SPEAKER
}

/** In-memory state of the transcription jobs of an active meeting. */
interface Job {
  /** One promise per segment and channel; they resolve even on error. */
  tasks: Promise<void>[]
  /**
   * Result per `"<index>:<channel>"`. Each segment produces up to two entries
   * (microphone and system), transcribed in parallel and interleaved later.
   */
  results: Map<string, TranscriptLine[]>
  /** Keys that failed, to report to the user. */
  failed: Set<string>
  language?: string
}

const jobs = new Map<string, Job>()

function emptyJob(): Job {
  return { tasks: [], results: new Map(), failed: new Set() }
}

function job(meetingId: string): Job {
  let existing = jobs.get(meetingId)
  if (!existing) {
    existing = emptyJob()
    jobs.set(meetingId, existing)
  }
  return existing
}

function resultKey(index: number, source: AudioSource): string {
  return `${index}:${source}`
}

function broadcast(channel: string, ...args: unknown[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, ...args)
  }
}

function emitMeeting(meeting: Meeting | null): void {
  if (meeting) broadcast('meeting:updated', meeting)
}

/**
 * Reassembles the transcript from what has come back so far.
 *
 * Sorts by absolute time, not by key: with two channels, microphone and system
 * lines have to be interleaved chronologically, not grouped by channel.
 */
function assembleTranscript(j: Job): TranscriptLine[] {
  const ordered = [...j.results.values()]
    .flat()
    .sort((a, b) => a.start - b.start || a.end - b.end)

  // Dedupe runs here, and not as each segment arrives, because it needs both
  // channels to compare. Since reassembly starts from scratch on every update,
  // it is idempotent: a microphone line that arrived before its counterpart on
  // the system channel survives this pass and drops out on the next one.
  const { lines, removed } = dedupeChannels(ordered)
  if (removed > 0) {
    console.log(`[meetings] ${removed} microphone line(s) dropped as echo`)
  }
  return lines
}

/**
 * Filters hallucinations per request, before storing the result.
 *
 * The scope is the request on purpose: repetition within a segment is a sign
 * of hallucination, but the same sentence reappearing over a long meeting may
 * be legitimate.
 */
function cleanLines(key: string, lines: TranscriptLine[]): TranscriptLine[] {
  const result = filterHallucinations(lines)
  if (result.removed > 0) {
    console.log(
      `[meetings] ${key}: ${result.removed} line(s) dropped — ${result.reason}`
    )
  }
  return result.lines
}

/**
 * Distinct speaker labels, qualified by their source segment.
 *
 * The qualification is not pedantry: the anonymous labels the API returns (`A`,
 * `B`, …) are scoped per request, so `A` in segment 0 and `A` in segment 1 may
 * be different people. Naming is always per meeting: no identity carries
 * across recordings.
 */

/** Reading order: by block, and microphone before system within a block. */
function sortIssues(issues: BlockIssue[]): BlockIssue[] {
  return [...issues].sort(
    (a, b) => a.index - b.index || (a.source ?? '').localeCompare(b.source ?? '')
  )
}

/**
 * Adds an issue to `meta.json`, replacing any previous record for the same
 * block and channel.
 *
 * The replacement matters: a block that failed and was then transcribed again
 * successfully must not stay listed as failed.
 */
function recordIssue(meetingId: string, issue: BlockIssue): Meeting | null {
  const meta = store.readMeta(meetingId)
  if (!meta) return null
  const kept = (meta.blockIssues ?? []).filter(
    (i) => !(i.index === issue.index && i.source === issue.source)
  )
  return store.patchMeta(meetingId, { blockIssues: sortIssues([...kept, issue]) })
}

/** Removes the issue record of a block that works again. */
function clearIssue(meetingId: string, index: number, source?: AudioSource): void {
  const meta = store.readMeta(meetingId)
  if (!meta?.blockIssues?.length) return
  const kept = meta.blockIssues.filter((i) => !(i.index === index && i.source === source))
  if (kept.length !== meta.blockIssues.length) {
    store.patchMeta(meetingId, { blockIssues: kept.length > 0 ? kept : undefined })
  }
}

function collectSpeakerLabels(lines: TranscriptLine[]): string[] {
  const labels = new Set<string>()
  for (const line of lines) {
    if (line.speaker) labels.add(`${line.segmentIndex ?? 0}:${line.speaker}`)
  }
  return [...labels].sort()
}

export function startMeeting(title: string): Meeting {
  const meeting = store.createMeeting(title)
  jobs.set(meeting.id, emptyJob())
  emitMeeting(meeting)
  return meeting
}

/**
 * Transcription strategy per channel.
 *
 * The microphone is always a single person — whoever is using the app. It makes
 * no sense to spend the (more expensive) diarization model on it: we use the
 * regular model and label it as "Me". Diarization, when on, goes
 * only on the system channel, where the remote participants are.
 */
function transcriptionPlan(
  source: AudioSource,
  settings: ReturnType<typeof getPublicSettings>
): { model: string; diarize: boolean; forcedSpeaker?: string } {
  if (source === 'mic') {
    return { model: settings.transcriptionModel, diarize: false, forcedSpeaker: SELF_SPEAKER }
  }
  if (settings.diarization) {
    return { model: settings.diarizationModel, diarize: true }
  }
  // Without diarization the channels still give "Me" vs "Others" for free.
  return { model: settings.transcriptionModel, diarize: false, forcedSpeaker: othersSpeaker() }
}

/**
 * Writes the segment to disk and fires off transcription in parallel. Doesn't
 * wait for Whisper — recording continues and the transcript shows up on screen
 * as it comes back.
 */
export function addSegment(payload: SegmentPayload): void {
  const { meetingId, index, startMs, durationMs, data, source, skipTranscription, stats } =
    payload
  const settings = getPublicSettings()
  const path = store.writeSegment(meetingId, index, source, Buffer.from(data))

  const meta = store.readMeta(meetingId)
  if (meta) {
    // The offsets are kept on disk because they are what later lets us find
    // which audio file an instant of the transcript falls in — needed to
    // locate the audio for an instant of the transcript.
    const offsets = [...(meta.segmentOffsetsMs ?? [])]
    offsets[index] = startMs

    // The measurement is kept on disk because the previous version computed the
    // level and threw it away — which made it impossible to explain, after the
    // fact, why a recording with a muted microphone got through the silence gate.
    const audioLevels = [...(meta.audioLevels ?? [])]
    if (stats) {
      audioLevels.push({
        index,
        source,
        peak: Number(stats.peak.toFixed(5)),
        floor: Number(stats.floor.toFixed(5)),
        activeMs: stats.activeMs,
        skipped: Boolean(skipTranscription)
      })
    }

    emitMeeting(
      store.patchMeta(meetingId, {
        segmentCount: Math.max(meta.segmentCount, index + 1),
        durationMs: Math.max(meta.durationMs, startMs + durationMs),
        segmentOffsetsMs: offsets,
        diarized: settings.diarization,
        skippedSilent: (meta.skippedSilent ?? 0) + (skipTranscription ? 1 : 0),
        audioLevels
      })
    )
  }

  // Silence goes to disk and not to the API. Without the `return` here the
  // savings wouldn't exist — it's the whole point of the check.
  if (skipTranscription) {
    console.log(`[meetings] segment ${index}:${source} is silent, transcription skipped`)
    return
  }

  const key = resultKey(index, source)
  const plan = transcriptionPlan(source, settings)
  const j = job(meetingId)

  const task = (async () => {
    try {
      const result = await transcribeFile({
        path,
        offsetSec: startMs / 1000,
        durationSec: durationMs / 1000,
        segmentIndex: index,
        source,
        model: plan.model,
        diarize: plan.diarize,
        forcedSpeaker: plan.forcedSpeaker
      })
      j.results.set(key, cleanLines(key, result.lines))
      if (result.language && !j.language) j.language = result.language

      if (result.truncationWarning) {
        console.warn(`[meetings] ${meetingId} block ${key}: ${result.truncationWarning}`)
        recordIssue(meetingId, {
          index,
          source,
          kind: 'truncated',
          message: result.truncationWarning,
          outputTokens: result.outputTokens,
          coveredSec: result.coveredSec,
          durationSec: durationMs / 1000
        })
        broadcast(
          'meeting:segment-error',
          meetingId,
          index,
          msgs().main.meetings.blockTruncated(index + 1, result.truncationWarning)
        )
      } else {
        // A block that came back intact clears the issue it had before —
        // without this a warning from an earlier attempt would stick to the
        // meeting.
        clearIssue(meetingId, index, source)
      }

      // Write the partial to disk so nothing is lost if the app crashes.
      const partial = assembleTranscript(j)
      store.writeTranscript(meetingId, partial)

      emitMeeting(
        store.patchMeta(meetingId, {
          transcribedCount: j.results.size,
          language: j.language
        })
      )
      broadcast('meeting:transcript', meetingId, partial)
    } catch (err) {
      console.error(`[meetings] segment ${key} of ${meetingId} failed:`, err)
      j.failed.add(key)
      recordIssue(meetingId, {
        index,
        source,
        kind: 'failed',
        message: friendlyError(err, false)
      })
      broadcast(
        'meeting:segment-error',
        meetingId,
        index,
        msgs().main.meetings.blockFailed(index + 1, source, friendlyError(err, false))
      )
    }
  })()

  j.tasks.push(task)
}

/**
 * Saves the notes and reconciles their timestamps.
 *
 * Alignment runs here, and not in the renderer, to be the single source of
 * truth: notes are saved both during recording and when edited afterwards, and
 * both paths need the same rule.
 *
 * @param elapsedMs recording instant; `null` when editing outside a meeting,
 *                  in which case new lines get no stamp rather than a false
 *                  one.
 */
export function saveNotes(
  meetingId: string,
  notes: string,
  elapsedMs: number | null
): void {
  const aligned = alignNoteStamps(
    store.readNoteLines(meetingId),
    notes,
    elapsedMs ?? undefined
  )
  store.writeNotes(meetingId, notes)
  store.writeNoteLines(meetingId, aligned)
}

/**
 * Ends the meeting: waits for pending segments, consolidates the transcript,
 * generates the minutes and, if the title is still the default, names the
 * meeting.
 */
export async function finishMeeting(
  meetingId: string,
  durationMs: number
): Promise<Meeting | null> {
  const settings = getPublicSettings()
  const j = job(meetingId)

  emitMeeting(
    store.patchMeta(meetingId, {
      status: 'transcribing',
      endedAt: new Date().toISOString(),
      durationMs
    })
  )

  await Promise.allSettled(j.tasks)

  const transcript = assembleTranscript(j)
  store.writeTranscript(meetingId, transcript)
  broadcast('meeting:transcript', meetingId, transcript)

  const labels = collectSpeakerLabels(transcript)
  if (labels.length > 0) store.patchMeta(meetingId, { speakerLabels: labels })

  const meta = store.readMeta(meetingId)
  if (!meta) return null

  if (j.failed.size > 0) {
    const failedList = [...j.failed].sort().join(', ')
    console.warn(`[meetings] ${meetingId}: failed segments: ${failedList}`)
  }

  // Nothing transcribed and no notes: there is nothing to summarize.
  const notes = store.readNotes(meetingId)
  if (transcript.length === 0 && !notes.trim()) {
    const m = msgs().main.meetings
    const failedNote =
      j.failed.size > 0 ? ` ${m.segmentsFailedTranscription(j.failed.size)}` : ''
    const result = store.patchMeta(meetingId, {
      status: 'error',
      error: `${m.nothingToSummarize}${failedNote}`,
      transcribedCount: j.results.size
    })
    emitMeeting(result)
    jobs.delete(meetingId)
    return result
  }

  emitMeeting(store.patchMeta(meetingId, { status: 'summarizing' }))

  try {
    const summary = await summarizeMeeting({
      title: meta.title,
      createdAt: meta.createdAt,
      durationMs,
      notes,
      transcript,
      model: settings.summaryModel,
      customInstructions: settings.customInstructions,
      speakerNames: meta.speakerNames,
      noteLines: store.readNoteLines(meetingId),
      tpmLimit: settings.tpmLimit
    })
    store.writeSummary(meetingId, summary)

    let title = meta.title
    if (isDefaultTitle(title)) {
      const generated = await generateTitle({
        notes,
        transcript,
        model: settings.summaryModel,
        tpmLimit: settings.tpmLimit
      })
      if (generated) title = generated
    }

    const result = store.patchMeta(meetingId, {
      status: 'ready',
      hasSummary: true,
      title,
      error:
        j.failed.size > 0
          ? msgs().main.meetings.segmentsNotTranscribed(j.failed.size)
          : undefined,
      transcribedCount: j.results.size,
      language: j.language
    })
    emitMeeting(result)
    jobs.delete(meetingId)
    return result
  } catch (err) {
    console.error(`[meetings] failed to summarize ${meetingId}:`, err)
    const result = store.patchMeta(meetingId, {
      status: 'error',
      error: friendlyError(err),
      transcribedCount: j.results.size
    })
    emitMeeting(result)
    jobs.delete(meetingId)
    return result
  }
}

/**
 * Default titles in every app language. Matches both regardless of the
 * current language: a meeting started before the user switched languages
 * still carries the old default, and must still get a generated title.
 */
const DEFAULT_TITLE_PATTERNS = [/^reuni[ãa]o sem t[íi]tulo/i, /^untitled meeting/i]

function isDefaultTitle(title: string): boolean {
  const t = title.trim()
  return !t || DEFAULT_TITLE_PATTERNS.some((re) => re.test(t))
}

/** Regenerates the minutes from the transcript and notes already saved. */
export async function regenerateSummary(meetingId: string): Promise<Meeting | null> {
  const settings = getPublicSettings()
  const meta = store.readMeta(meetingId)
  if (!meta) return null

  emitMeeting(store.patchMeta(meetingId, { status: 'summarizing', error: undefined }))

  try {
    const summary = await summarizeMeeting({
      title: meta.title,
      createdAt: meta.createdAt,
      durationMs: meta.durationMs,
      notes: store.readNotes(meetingId),
      transcript: store.readTranscript(meetingId),
      model: settings.summaryModel,
      customInstructions: settings.customInstructions,
      speakerNames: meta.speakerNames,
      noteLines: store.readNoteLines(meetingId),
      tpmLimit: settings.tpmLimit
    })
    store.writeSummary(meetingId, summary)
    const result = store.patchMeta(meetingId, { status: 'ready', hasSummary: true })
    emitMeeting(result)
    return result
  } catch (err) {
    const result = store.patchMeta(meetingId, {
      status: 'error',
      error: friendlyError(err)
    })
    emitMeeting(result)
    return result
  }
}

/**
 * Retranscribes every audio segment still on disk. Useful when the network
 * dropped mid-meeting or the key was invalid.
 */
export async function retranscribe(meetingId: string): Promise<Meeting | null> {
  const settings = getPublicSettings()
  const meta = store.readMeta(meetingId)
  if (!meta) return null

  const dir = join(store.meetingDir(meetingId), 'audio')
  if (!existsSync(dir)) {
    const result = store.patchMeta(meetingId, {
      status: 'error',
      error: msgs().main.meetings.audioRemoved
    })
    emitMeeting(result)
    return result
  }

  /**
   * Splits file names into (index, channel). Meetings recorded before channel
   * separation have `seg-0001.webm` with no suffix: we treat it as the system
   * channel, because it was mixed audio and the source can't be recovered.
   */
  const parsed = readdirSync(dir)
    .filter((f) => f.endsWith('.webm'))
    .map((file) => {
      const match = /^seg-(\d+)(?:-(mic|system))?\.webm$/.exec(file)
      if (!match) return null
      return {
        file,
        index: Number(match[1]),
        source: (match[2] as AudioSource | undefined) ?? ('system' as AudioSource),
        legacy: match[2] === undefined
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => a.index - b.index || a.source.localeCompare(b.source))

  if (parsed.length === 0) {
    const result = store.patchMeta(meetingId, {
      status: 'error',
      error: msgs().main.meetings.noSegments
    })
    emitMeeting(result)
    return result
  }

  emitMeeting(store.patchMeta(meetingId, { status: 'transcribing', error: undefined }))

  const fresh = emptyJob()
  jobs.set(meetingId, fresh)
  const segmentMs = settings.segmentMinutes * 60_000
  const issues: BlockIssue[] = []

  // Bounded concurrency: see `pool.ts`. Firing every block at once blew
  // OpenAI's request limit on long meetings.
  await mapWithLimit(parsed, TRANSCRIBE_CONCURRENCY, async (entry) => {
    const key = resultKey(entry.index, entry.source)
    try {
      // We prefer the recorded offsets; the estimate from segment size is only
      // for old meetings, from before we started persisting them. It is wrong
      // if the configuration changed since the recording — it shifts the
      // timestamps, not the text.
      const offsetMs = meta.segmentOffsetsMs?.[entry.index] ?? entry.index * segmentMs
      // Old mixed audio has no reliable channel, so it gets no fixed label:
      // claiming "Others" there would be wrong, since it includes your voice.
      const plan = entry.legacy
        ? {
            model: settings.diarization
              ? settings.diarizationModel
              : settings.transcriptionModel,
            diarize: settings.diarization,
            forcedSpeaker: undefined
          }
        : transcriptionPlan(entry.source, settings)

      const result = await transcribeFile({
        path: join(dir, entry.file),
        offsetSec: offsetMs / 1000,
        durationSec: segmentMs / 1000,
        segmentIndex: entry.index,
        source: entry.legacy ? undefined : entry.source,
        model: plan.model,
        diarize: plan.diarize,
        forcedSpeaker: plan.forcedSpeaker
      })
      fresh.results.set(key, cleanLines(key, result.lines))
      if (result.language && !fresh.language) fresh.language = result.language

      // The previous version discarded `truncationWarning` here. The recording
      // path warned, the retranscription path silently lost the end of the
      // block — and it is precisely the path used to repair a meeting.
      if (result.truncationWarning) {
        console.warn(`[meetings] ${meetingId} block ${key}: ${result.truncationWarning}`)
        issues.push({
          index: entry.index,
          source: entry.legacy ? undefined : entry.source,
          kind: 'truncated',
          message: result.truncationWarning,
          outputTokens: result.outputTokens,
          coveredSec: result.coveredSec,
          durationSec: segmentMs / 1000
        })
      }

      emitMeeting(store.patchMeta(meetingId, { transcribedCount: fresh.results.size }))
    } catch (err) {
      console.error(`[meetings] retranscription of segment ${key} failed:`, err)
      fresh.failed.add(key)
      issues.push({
        index: entry.index,
        source: entry.legacy ? undefined : entry.source,
        kind: 'failed',
        message: friendlyError(err, false)
      })
    }
  })

  const transcript = assembleTranscript(fresh)
  store.writeTranscript(meetingId, transcript)
  broadcast('meeting:transcript', meetingId, transcript)
  const labels = collectSpeakerLabels(transcript)
  emitMeeting(
    store.patchMeta(meetingId, {
      transcribedCount: fresh.results.size,
      language: fresh.language,
      diarized: settings.diarization,
      speakerLabels: labels.length > 0 ? labels : undefined,
      // Replaces instead of accumulating: this pass reprocessed all the audio,
      // so the previous pass's issues no longer describe what is on disk.
      blockIssues: issues.length > 0 ? sortIssues(issues) : undefined
    })
  )

  jobs.delete(meetingId)
  return regenerateSummary(meetingId)
}

/**
 * A meeting interrupted by an abrupt app shutdown gets stuck in 'recording'.
 * We mark it as a recoverable error at startup.
 */
export function reconcileOrphans(): void {
  const m = msgs().main.meetings
  for (const meeting of store.listMeetings()) {
    if (meeting.status === 'recording' || meeting.status === 'transcribing') {
      store.patchMeta(meeting.id, {
        status: 'error',
        error: m.interruptedRecording
      })
    } else if (meeting.status === 'summarizing') {
      store.patchMeta(meeting.id, {
        status: 'error',
        error: m.interruptedSummary
      })
    }
  }
}
