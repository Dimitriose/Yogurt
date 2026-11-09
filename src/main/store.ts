import { app } from 'electron'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  rmSync
} from 'node:fs'
import { join } from 'node:path'
import type { AudioSource, Meeting, MeetingDetail, TranscriptLine } from '@shared/types'
import type { NoteLine } from '@shared/notes'
import { msgs } from '@shared/i18n'

/**
 * File-based persistence, one directory per meeting:
 *
 *   <userData>/meetings/<id>/
 *     meta.json        Meeting
 *     notes.md         the user's raw notes
 *     transcript.json  TranscriptLine[]
 *     summary.md       generated minutes
 *     audio/seg-0001.webm
 *
 * No SQLite on purpose: zero native modules, trivial backup and sync, and the
 * content stays readable outside the app.
 */

function meetingsDir(): string {
  const dir = join(app.getPath('userData'), 'meetings')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * IDs arrive from the renderer over IPC and become paths on disk — including in
 * the recursive `rmSync` of `deleteMeeting`. An ID like `..\..` would delete
 * folders outside the app. Every access goes through here; the format is what
 * `createMeeting` generates (ISO date without `:`/`.` plus a random suffix).
 */
const MEETING_ID = /^[0-9A-Za-z-]{1,80}$/

export function isMeetingId(id: unknown): id is string {
  return typeof id === 'string' && MEETING_ID.test(id)
}

function dirOf(id: string): string {
  if (!isMeetingId(id)) throw new Error(msgs().system.store.invalidMeetingId(JSON.stringify(id)))
  return join(meetingsDir(), id)
}

function assertSegment(index: number, source: AudioSource | 'legacy'): void {
  if (!Number.isInteger(index) || index < 0 || index > 99_999) {
    throw new Error(msgs().system.store.invalidSegmentIndex(index))
  }
  if (source !== 'mic' && source !== 'system' && source !== 'legacy') {
    throw new Error(msgs().system.store.invalidAudioChannel(String(source)))
  }
}

export function meetingDir(id: string): string {
  const dir = dirOf(id)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function audioDir(id: string): string {
  const dir = join(meetingDir(id), 'audio')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Path of the audio folder **without** creating it. `meetingDir` and `audioDir`
 * create it as a side effect, which is right when recording and wrong on any
 * path that only wants to read — such as the cost estimate.
 */
export function audioDirPath(id: string): string {
  return join(dirOf(id), 'audio')
}

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T
  } catch (err) {
    console.error(`[store] invalid JSON in ${path}:`, err)
    return fallback
  }
}

function readText(path: string): string {
  if (!existsSync(path)) return ''
  try {
    return readFileSync(path, 'utf-8')
  } catch {
    return ''
  }
}

export function createMeeting(title: string): Meeting {
  const now = new Date()
  const id = `${now.toISOString().replace(/[:.]/g, '-')}-${Math.random()
    .toString(36)
    .slice(2, 8)}`
  const meeting: Meeting = {
    id,
    title,
    createdAt: now.toISOString(),
    durationMs: 0,
    status: 'recording',
    segmentCount: 0,
    transcribedCount: 0,
    hasSummary: false
  }
  writeMeta(meeting)
  writeNotes(id, '')
  return meeting
}

export function writeMeta(meeting: Meeting): void {
  writeFileSync(
    join(meetingDir(meeting.id), 'meta.json'),
    JSON.stringify(meeting, null, 2),
    'utf-8'
  )
}

export function readMeta(id: string): Meeting | null {
  const path = join(dirOf(id), 'meta.json')
  if (!existsSync(path)) return null
  return readJson<Meeting | null>(path, null)
}

/** Applies a partial patch to the meta and returns the written result. */
export function patchMeta(id: string, patch: Partial<Meeting>): Meeting | null {
  const current = readMeta(id)
  if (!current) return null
  const next = { ...current, ...patch }
  writeMeta(next)
  return next
}

export function writeNotes(id: string, notes: string): void {
  writeFileSync(join(meetingDir(id), 'notes.md'), notes, 'utf-8')
}

export function readNotes(id: string): string {
  return readText(join(dirOf(id), 'notes.md'))
}

/**
 * Note timestamps.
 *
 * Kept in a separate file so `notes.md` stays plain text — readable outside the
 * app and straight into the export. If this file is lost, the notes survive
 * without the timestamps.
 */
export function writeNoteLines(id: string, lines: NoteLine[]): void {
  writeFileSync(
    join(meetingDir(id), 'notes.timeline.json'),
    JSON.stringify(lines, null, 2),
    'utf-8'
  )
}

export function readNoteLines(id: string): NoteLine[] {
  return readJson<NoteLine[]>(join(dirOf(id), 'notes.timeline.json'), [])
}

export function writeTranscript(id: string, lines: TranscriptLine[]): void {
  writeFileSync(
    join(meetingDir(id), 'transcript.json'),
    JSON.stringify(lines, null, 2),
    'utf-8'
  )
}

export function readTranscript(id: string): TranscriptLine[] {
  return readJson<TranscriptLine[]>(join(dirOf(id), 'transcript.json'), [])
}

export function writeSummary(id: string, summary: string): void {
  writeFileSync(join(meetingDir(id), 'summary.md'), summary, 'utf-8')
}

export function readSummary(id: string): string {
  return readText(join(dirOf(id), 'summary.md'))
}

/**
 * File name of a segment. The channel suffix was added when we started
 * recording microphone and system separately; `legacy` reproduces the old
 * (mixed) name, still on disk for meetings recorded before that.
 */
export function segmentFileName(index: number, source: AudioSource | 'legacy'): string {
  assertSegment(index, source)
  const n = String(index).padStart(4, '0')
  return source === 'legacy' ? `seg-${n}.webm` : `seg-${n}-${source}.webm`
}

export function writeSegment(
  id: string,
  index: number,
  source: AudioSource,
  data: Buffer
): string {
  const path = join(audioDir(id), segmentFileName(index, source))
  writeFileSync(path, data)
  return path
}

/**
 * Reads a raw audio segment.
 * Tries the requested channel and falls back to the old (mixed) name for
 * meetings recorded before the channel split.
 */
export function readSegment(
  id: string,
  index: number,
  source: AudioSource = 'system'
): Buffer | null {
  const dir = join(dirOf(id), 'audio')
  for (const candidate of [segmentFileName(index, source), segmentFileName(index, 'legacy')]) {
    const path = join(dir, candidate)
    if (existsSync(path)) return readFileSync(path)
  }
  return null
}

export function listMeetings(): Meeting[] {
  const dir = meetingsDir()
  const entries = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory())
  const meetings: Meeting[] = []
  for (const entry of entries) {
    // Hand-made folders with non-conforming names are skipped, not an error.
    if (!isMeetingId(entry.name)) continue
    const meta = readMeta(entry.name)
    if (meta) meetings.push(meta)
  }
  return meetings.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function getMeetingDetail(id: string): MeetingDetail | null {
  const meta = readMeta(id)
  if (!meta) return null
  return {
    ...meta,
    notes: readNotes(id),
    noteLines: readNoteLines(id),
    transcript: readTranscript(id),
    summary: readSummary(id)
  }
}

export function deleteMeeting(id: string): void {
  const dir = dirOf(id)
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
}

/** Removes only the audio, keeping transcript and minutes. Frees a lot of disk. */
export function deleteMeetingAudio(id: string): void {
  const dir = join(dirOf(id), 'audio')
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
}

export function meetingsRoot(): string {
  return meetingsDir()
}
