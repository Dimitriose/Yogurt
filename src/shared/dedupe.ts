import type { TranscriptLine } from './types'

/**
 * Removes echo from the microphone channel.
 *
 * Channel separation assumes the microphone contains only the voice of whoever
 * is using the app. That holds with headphones; listening through speakers, the
 * microphone picks the remote voices back up, and Chromium's
 * `echoCancellation` can't cope on its own.
 *
 * Measured on a real recording: **62% of the microphone lines duplicated the
 * system channel**, one of them at 100% similarity. Two consequences, both bad:
 * the transcript contained the conversation twice, and other people's speech
 * got the "Me" label (`SELF_SPEAKER`).
 *
 * The rule is asymmetric on purpose: when in doubt, drop the **microphone**
 * line. The system channel is clean by construction (loopback of the output
 * device), so it is the source of truth for what the others said. What remains
 * on the microphone is what only exists there — your voice.
 */

/** Search window. Echo is nearly simultaneous; the slack covers misalignment
 *  between the independent transcriptions of the two channels. */
const WINDOW_SEC = 8

/** Similarity above which two lines are the same utterance. */
const SIMILARITY = 0.6

/** Very short lines match by chance ("yes", "ok"), so they require near equality. */
const SHORT_LINE_CHARS = 12
const SHORT_SIMILARITY = 0.9

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .split(/\s+/)
    .filter(Boolean)
}

/**
 * Fraction of the shorter line's words present in the longer one. Chosen over
 * edit distance because echo arrives with small recognition differences
 * ("começar as duas e meia" vs "começar então uma e meia"), and word overlap
 * tolerates that better.
 */
function similarity(a: string, b: string): number {
  const ta = tokenize(a)
  const tb = tokenize(b)
  if (ta.length === 0 || tb.length === 0) return 0

  const [shorter, longer] = ta.length <= tb.length ? [ta, tb] : [tb, ta]
  const pool = new Map<string, number>()
  for (const word of longer) pool.set(word, (pool.get(word) ?? 0) + 1)

  let hits = 0
  for (const word of shorter) {
    const left = pool.get(word) ?? 0
    if (left > 0) {
      hits++
      pool.set(word, left - 1)
    }
  }
  return hits / shorter.length
}

export interface DedupeResult {
  lines: TranscriptLine[]
  /** Microphone lines dropped for being echo. */
  removed: number
}

export function dedupeChannels(lines: TranscriptLine[]): DedupeResult {
  const system = lines.filter((l) => l.source === 'system')
  // Without both channels there's no echo to remove.
  if (system.length === 0) return { lines, removed: 0 }

  let removed = 0
  const kept = lines.filter((line) => {
    if (line.source !== 'mic') return true

    const echo = system.some((other) => {
      if (Math.abs(other.start - line.start) > WINDOW_SEC) return false
      const needed =
        Math.min(line.text.length, other.text.length) <= SHORT_LINE_CHARS
          ? SHORT_SIMILARITY
          : SIMILARITY
      return similarity(line.text, other.text) >= needed
    })

    if (echo) removed++
    return !echo
  })

  return { lines: kept, removed }
}
