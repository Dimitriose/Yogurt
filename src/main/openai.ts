import { friendlyError } from './apiErrors'
import OpenAI, { toFile } from 'openai'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type { AudioSource, TranscriptLine } from '@shared/types'
import { msgs } from '@shared/i18n'
import { chromiumFetch } from './chromiumFetch'
import { getApiKey } from './settings'
import {
  summarySystem,
  titleSystem,
  chunkSystem,
  prompts,
  buildSummaryPrompt,
  transcriptToText,
  interleaveNotesAndTranscript
} from './prompts'
import { stampedNotes, type NoteLine } from '@shared/notes'
import {
  DEFAULT_TPM_LIMIT,
  TpmGate,
  estimateTokens,
  isRequestTooLarge,
  parseTpmLimit,
  promptBudget
} from './tokenBudget'

/**
 * Absolute transcript ceiling, dictated by the model's context window.
 *
 * It is no longer the condensation trigger: on a first-tier account the TPM
 * (30k tokens) bites long before these 240k chars (~63k tokens). The real
 * trigger now comes from `promptBudget()`, computed from the account's TPM. This
 * value remains as an upper bound for large accounts, where TPM is not what
 * constrains.
 */
const MAX_TRANSCRIPT_CHARS = 240_000

let client: OpenAI | null = null
let clientKey: string | null = null

function getClient(): OpenAI {
  const key = getApiKey()
  if (!key) {
    throw new Error(msgs().main.openai.noApiKey)
  }
  // Recreate the client if the key changed.
  if (!client || clientKey !== key) {
    client = new OpenAI({
      apiKey: key,
      maxRetries: 3,
      // See chromiumFetch: without it, nothing works behind a TLS-inspecting
      // proxy, which is this app's target environment.
      fetch: chromiumFetch as unknown as typeof fetch
    })
    clientKey = key
  }
  return client
}

/** Invalidates the cached client — call after changing the key in settings. */
export function resetClient(): void {
  client = null
  clientKey = null
}

export interface TranscriptionResult {
  lines: TranscriptLine[]
  language?: string
  /** Set when the response is suspected to have been cut off by the token limit. */
  truncationWarning?: string
  /**
   * Output tokens consumed, when the API reports them. Always recorded — not
   * only on truncation — because it is what tells how far from the ceiling a
   * normal meeting runs, instead of finding out only when it overflows.
   */
  outputTokens?: number
  /** Last instant covered by the response, in seconds from the start of the block. */
  coveredSec?: number
}

/** Output ceiling of the diarization model, used as a truncation signal. */
const DIARIZE_OUTPUT_TOKEN_LIMIT = 2000

/**
 * Detects a response cut off by the output token ceiling.
 *
 * Hitting the ceiling is not an error: the response comes back 200 and the
 * **end of the block is simply missing**. Without this check, the loss is
 * silent.
 *
 * Two signals combined, because neither suffices alone: the transcript stopping
 * well before the end of the audio may just be trailing silence, and high token
 * usage may be legitimate. Together, they indicate a cut.
 */
function detectTruncation(
  lines: TranscriptLine[],
  offsetSec: number,
  durationSec: number | undefined,
  outputTokens: number | undefined
): string | undefined {
  if (!durationSec || durationSec <= 0 || lines.length === 0) return undefined

  const lastEnd = lines[lines.length - 1].end - offsetSec
  const coverage = lastEnd / durationSec
  if (coverage >= 0.85) return undefined

  // Token usage known and far from the ceiling: the gap is silence, not a cut.
  if (outputTokens !== undefined && outputTokens < DIARIZE_OUTPUT_TOKEN_LIMIT * 0.95) {
    return undefined
  }

  const m = msgs().main.openai
  const missing = Math.round(durationSec - lastEnd)
  const tokenNote =
    outputTokens !== undefined ? m.truncationTokens(outputTokens, DIARIZE_OUTPUT_TOKEN_LIMIT) : ''
  return m.truncation(missing, tokenNote)
}

/** Extracts output tokens from `usage`, whose shape varies by model. */
function readOutputTokens(response: unknown): number | undefined {
  const usage = (response as { usage?: { type?: string; output_tokens?: number } })?.usage
  if (usage?.type === 'tokens' && typeof usage.output_tokens === 'number') {
    return usage.output_tokens
  }
  return undefined
}

/**
 * Diarization path, via `gpt-4o-transcribe-diarize`.
 *
 * Relevant differences from whisper-1, all verified in the API docs:
 * `response_format` is `diarized_json`; audio over 30s requires
 * `chunking_strategy: 'auto'`; `prompt` is not supported; and anonymous labels
 * come out as sequential letters (`A`, `B`, …) **per request** — they are not
 * stable across segments. Naming them is the user's job, in the Speakers tab.
 */
async function transcribeDiarized(
  openai: OpenAI,
  file: Awaited<ReturnType<typeof toFile>>,
  opts: {
    offsetSec: number
    model: string
    durationSec?: number
    segmentIndex?: number
    source?: AudioSource
  }
): Promise<TranscriptionResult> {
  const response = await openai.audio.transcriptions.create({
    file,
    model: opts.model,
    response_format: 'diarized_json',
    // Required above 30s of audio; our segments are always longer than that.
    chunking_strategy: 'auto'
  })

  const raw = response as unknown as {
    text?: string
    duration?: number
    segments?: Array<{ start: number; end: number; text: string; speaker?: string }>
  }

  const outputTokens = readOutputTokens(response)
  // Always logged: it is the data that lets us calibrate the segment size by
  // measurement instead of estimation.
  console.log(
    `[openai] diarization block ${opts.segmentIndex ?? '?'}: ` +
      `${raw.segments?.length ?? 0} segments, ${outputTokens ?? '?'} output tokens ` +
      `(ceiling ${DIARIZE_OUTPUT_TOKEN_LIMIT})`
  )

  if (raw.segments?.length) {
    const lines = raw.segments
      .map((seg) => ({
        start: seg.start + opts.offsetSec,
        end: seg.end + opts.offsetSec,
        text: seg.text.trim(),
        speaker: seg.speaker,
        segmentIndex: opts.segmentIndex,
        source: opts.source
      }))
      .filter((l) => l.text.length > 0)
    return {
      lines,
      outputTokens,
      coveredSec: lines.length ? lines[lines.length - 1].end - opts.offsetSec : 0,
      truncationWarning: detectTruncation(
        lines,
        opts.offsetSec,
        opts.durationSec,
        outputTokens
      )
    }
  }

  const text = (raw.text ?? '').trim()
  if (!text) return { lines: [] }
  return {
    lines: [
      {
        start: opts.offsetSec,
        end: opts.offsetSec + (raw.duration ?? opts.durationSec ?? 0),
        text,
        segmentIndex: opts.segmentIndex
      }
    ]
  }
}

/**
 * Transcribes an audio segment, shifting the timestamps to the meeting's
 * absolute time.
 */
export async function transcribeFile(opts: {
  path: string
  offsetSec: number
  model: string
  /** Known segment duration, used when the model returns no timestamps. */
  durationSec?: number
  /** Segment index, propagated to the lines (disambiguates anonymous labels). */
  segmentIndex?: number
  /** Source channel, propagated to the lines. */
  source?: AudioSource
  /** Turns on the diarization path. Requires a model that supports it. */
  diarize?: boolean
  /**
   * Fixed label applied to every line. Used when the channel already determines
   * who is speaking — the microphone is always the user themselves.
   */
  forcedSpeaker?: string
}): Promise<TranscriptionResult> {
  const openai = getClient()

  // The body is buffered, not streamed: Chromium's `net.fetch` doesn't accept a
  // streaming request body. A segment of a few minutes in Opus is around
  // 1–2 MB, so loading it into memory is irrelevant.
  const buffer = await readFile(opts.path)
  const file = await toFile(buffer, basename(opts.path), { type: 'audio/webm' })

  if (opts.diarize) {
    return transcribeDiarized(openai, file, opts)
  }

  // Only whisper-1 accepts verbose_json and per-segment timestamps. The
  // gpt-4o-transcribe models reject both, and become a single line per segment.
  const supportsTimestamps = opts.model === 'whisper-1'

  const response = await openai.audio.transcriptions.create({
    file,
    model: opts.model,
    ...(supportsTimestamps
      ? { response_format: 'verbose_json' as const, timestamp_granularities: ['segment' as const] }
      : { response_format: 'json' as const })
  })

  // The SDK types verbose_json loosely; we normalize here.
  const raw = response as unknown as {
    text?: string
    language?: string
    duration?: number
    segments?: Array<{ start: number; end: number; text: string }>
  }

  if (raw.segments?.length) {
    const lines = raw.segments
      .map((seg) => ({
        start: seg.start + opts.offsetSec,
        end: seg.end + opts.offsetSec,
        text: seg.text.trim(),
        segmentIndex: opts.segmentIndex,
        source: opts.source,
        speaker: opts.forcedSpeaker
      }))
      .filter((l) => l.text.length > 0)
    return { lines, language: raw.language }
  }

  // Models that return no segments: fall back to a single line.
  const text = (raw.text ?? '').trim()
  if (!text) return { lines: [], language: raw.language }
  return {
    lines: [
      {
        start: opts.offsetSec,
        end: opts.offsetSec + (raw.duration ?? opts.durationSec ?? 0),
        text,
        segmentIndex: opts.segmentIndex,
        source: opts.source,
        speaker: opts.forcedSpeaker
      }
    ],
    language: raw.language
  }
}

/**
 * TPM gate shared by all text calls.
 *
 * Global, not per meeting: the ceiling belongs to the organization, so two
 * meetings processed at the same time compete for the same budget.
 */
let gate = new TpmGate(DEFAULT_TPM_LIMIT)
let gateLimit = DEFAULT_TPM_LIMIT

function ensureGate(limit: number): TpmGate {
  if (limit !== gateLimit) {
    gate = new TpmGate(limit)
    gateLimit = limit
  }
  return gate
}

/**
 * Runs a chat call within the TPM budget.
 *
 * If the API reveals a ceiling different from the configured one in a 429, we
 * adopt its value: it is more reliable than the configuration, and spares the
 * user from having to dig the number out of the OpenAI dashboard.
 */
async function chatWithBudget(
  openai: OpenAI,
  tpmLimit: number,
  input: string,
  request: Parameters<OpenAI['chat']['completions']['create']>[0]
): Promise<string> {
  const g = ensureGate(tpmLimit)
  await g.reserve(estimateTokens(input))

  try {
    const res = await openai.chat.completions.create(request)
    return (
      (res as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message
        ?.content ?? ''
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const revealed = parseTpmLimit(message)
    if (revealed) {
      console.warn(
        `[openai] account reported a TPM of ${revealed} (configured: ${tpmLimit}). Adopting the API value.`
      )
      g.setLimit(revealed)
      gateLimit = revealed
    }
    if (isRequestTooLarge(message)) {
      // Retrying doesn't help: the prompt doesn't fit the ceiling and never
      // will. This message replaces the raw API text, which doesn't say what
      // to do.
      throw new Error(msgs().main.openai.requestTooLarge(revealed ?? tpmLimit))
    }
    throw err
  }
}

/**
 * Overlap between consecutive parts, in chars.
 *
 * **Why it exists.** The previous version cut at line boundaries with no
 * overlap at all, and a commitment stated across the cut was lost: the first
 * part saw "I'll close this with legal" without the deadline, and the second
 * saw "by Friday" without knowing what it referred to. Neither recorded the
 * item, and the result was silently incomplete minutes — only in long
 * meetings, which is when condensation kicks in and nobody checks.
 *
 * 2,000 chars cover ~20 turns in the interleaved format, well beyond the few
 * turns of a commitment. The cost is the repeated stretch appearing in two
 * condensations; the final pass reconciles it, and repeating is cheaper than
 * losing.
 */
const CHUNK_OVERLAP_CHARS = 2_000

function splitIntoChunks(text: string, size: number): string[] {
  const lines = text.split('\n')
  const chunks: string[] = []
  // Capped at a quarter of the chunk: if it reached `size`, the advance would
  // be zero and the loop would never end.
  const overlap = Math.min(CHUNK_OVERLAP_CHARS, Math.floor(size / 4))

  let current: string[] = []
  let length = 0

  const flush = (): void => {
    if (current.length === 0) return
    chunks.push(current.join('\n'))

    // The last lines become the head of the next chunk.
    const carry: string[] = []
    let carried = 0
    for (let i = current.length - 1; i >= 0; i--) {
      const next = carried + current[i].length + 1
      if (next > overlap) break
      carry.unshift(current[i])
      carried = next
    }
    current = carry
    length = carried
  }

  for (const line of lines) {
    // A single line larger than the chunk must not stall progress: emit it whole.
    if (line.length + 1 > size) {
      if (current.length > 0) {
        chunks.push(current.join('\n'))
        current = []
        length = 0
      }
      chunks.push(line)
      continue
    }
    if (length + line.length + 1 > size && current.length > 0) flush()
    current.push(line)
    length += line.length + 1
  }

  if (current.length > 0) chunks.push(current.join('\n'))
  return chunks
}

/**
 * Shrinks a very long transcript by condensing it in parts, so it fits the
 * summarization model's context without losing concrete details.
 */
async function condenseTranscript(
  text: string,
  model: string,
  tpmLimit: number
): Promise<string> {
  const openai = getClient()
  const budget = promptBudget(tpmLimit)
  const p = prompts()
  const system = chunkSystem()
  // Parts are sized by the budget, not by a fixed size: with a CHUNK_CHARS of
  // 60k, a single part already exceeded 15k tokens, and two blew a 30k ceiling
  // even though each fit on its own.
  const chunks = splitIntoChunks(text, budget.maxInputChars)
  console.log(
    `[openai] long transcript (${text.length} chars): condensing into ` +
      `${chunks.length} part(s) of up to ${budget.maxInputChars} chars`
  )

  // Sequential, not `Promise.all`: the parts compete for the same per-minute
  // ceiling. In parallel they add up and the 429 comes back — that is how the
  // previous version turned the safety valve into another way to fail. The
  // `TpmGate` inside `chatWithBudget` inserts the wait when it is needed.
  const condensed: string[] = []
  for (const [i, chunk] of chunks.entries()) {
    const content = await chatWithBudget(openai, tpmLimit, system + chunk, {
      model,
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: p.chunkUser(i + 1, chunks.length, chunk)
        }
      ]
    })
    condensed.push(`${p.chunkHeading(i + 1, chunks.length)}\n${content.trim()}`)
  }

  return condensed.join('\n\n')
}

export async function summarizeMeeting(opts: {
  title: string
  createdAt: string
  durationMs: number
  notes: string
  transcript: TranscriptLine[]
  model: string
  customInstructions: string
  /** Names assigned by the user, applied before building the prompt. */
  speakerNames?: Record<string, string>
  /** Line-by-line notes with timestamps, to interleave into the transcript. */
  noteLines?: NoteLine[]
  /** The account's tokens-per-minute ceiling. */
  tpmLimit: number
}): Promise<string> {
  const openai = getClient()

  const timed = stampedNotes(opts.noteLines ?? [])
  const hasTimedNotes = timed.length > 0

  let transcriptText = hasTimedNotes
    ? interleaveNotesAndTranscript(opts.transcript, opts.noteLines ?? [], opts.speakerNames)
    : transcriptToText(opts.transcript, opts.speakerNames)

  // The trigger is the smaller of the per-minute budget and the context window.
  // It used to be only the context window, which is why a 98-min meeting went
  // straight through and died with a 429 instead of being condensed.
  const budget = promptBudget(opts.tpmLimit)
  const threshold = Math.min(budget.maxInputChars, MAX_TRANSCRIPT_CHARS)

  let condensed = false
  if (transcriptText.length > threshold) {
    // Condensation preserves the content but undoes the fine alignment; the
    // prompt stops announcing the notes as interleaved so it doesn't promise
    // structure that is no longer there.
    transcriptText = await condenseTranscript(transcriptText, opts.model, opts.tpmLimit)
    condensed = true
  }

  const prompt = buildSummaryPrompt({
    title: opts.title,
    createdAt: opts.createdAt,
    durationMs: opts.durationMs,
    notes: opts.notes,
    transcript: transcriptText,
    customInstructions: opts.customInstructions,
    diarized: opts.transcript.some((l) => l.speaker),
    timedNotes: hasTimedNotes && !condensed
  })

  const system = summarySystem()
  const content = (
    await chatWithBudget(openai, opts.tpmLimit, system + prompt, {
      model: opts.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt }
      ]
    })
  ).trim()
  if (!content) throw new Error(msgs().main.openai.emptySummary)
  return content
}

/** Generates a title from the notes and the start of the transcript. */
export async function generateTitle(opts: {
  notes: string
  transcript: TranscriptLine[]
  model: string
  tpmLimit: number
}): Promise<string | null> {
  const openai = getClient()
  const head = transcriptToText(opts.transcript).slice(0, 6_000)
  const notes = opts.notes.trim().slice(0, 4_000)
  if (!head && !notes) return null

  const content = prompts().titleUser(notes, head)
  const system = titleSystem()

  try {
    // Goes through the same gate: the title is generated right after the
    // minutes, within the same one-minute window, and would add to their spend.
    const raw = await chatWithBudget(openai, opts.tpmLimit, system + content, {
      model: opts.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content }
      ]
    })
    const title = raw.trim().replace(/^["']|["']$/g, '')
    return title || null
  } catch (err) {
    console.error('[openai] failed to generate title:', err)
    return null
  }
}

/** Validates the key with a cheap call. */
export async function testApiKey(): Promise<{ ok: boolean; error?: string }> {
  try {
    const openai = getClient()
    await openai.models.list()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: friendlyError(err, false) }
  }
}
