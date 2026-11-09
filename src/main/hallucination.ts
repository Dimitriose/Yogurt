import type { TranscriptLine } from '@shared/types'

/**
 * Removes Whisper hallucinations.
 *
 * Faced with silence or non-speech noise, Whisper doesn't return nothing: it
 * returns artifacts from its training material. Observed in a real 18-min
 * recording with the microphone muted — Welsh repeated 14 times
 * (`"Rydyn ni'n gwybod beth sy'n digwydd…"`), `"Diolch am wylio'r ffilm"`
 * ("thanks for watching the film", a video subtitle), and `"You"` five times.
 *
 * This is the **second** line of defense. The first is not sending audio
 * without speech, in the `AudioEngine`. The filter exists because no silence
 * detector is always right, and the cost of letting junk through is a polluted
 * transcript and the chance of contaminating the minutes.
 */

/**
 * Known subtitle artifacts from Whisper's training data. This is detection data,
 * not UI text: the Portuguese patterns stay regardless of the UI language.
 */
const ARTIFACTS = [
  /amara\.org/i,
  /diolch am wylio/i,
  /legendas? (pela|por) comunidade/i,
  /subtitles? by/i,
  /subtitled by/i,
  /thanks? for watching/i,
  /thank you (so much |very much )?for watching/i,
  /subscribe to (my|our|the) channel/i,
  /obrigado por assistir/i,
  /transcri(ção|pt) by/i,
  /^\s*legenda[s]?\s*[:.]?\s*$/i,
  /www\.[a-z0-9-]+\.(com|org|net)/i
]

/**
 * Repetition is only suspicious in long text. Real speech repeats short
 * interjections ("Uh-huh.", "OK.") all the time, and dropping them would lose
 * conversation.
 */
const MIN_REPEAT_LENGTH = 25
const MIN_REPEAT_COUNT = 3

/**
 * Fraction of identical lines above which the whole block is considered a
 * hallucination. Catches the `"You"` × 5 case, which escapes the repetition rule
 * for being short.
 */
const BLOCK_UNIFORMITY = 0.7
const BLOCK_MIN_LINES = 4

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ')
}

export interface FilterResult {
  lines: TranscriptLine[]
  /** How many lines were dropped, for logging. */
  removed: number
  reason?: 'artifact' | 'repetition' | 'uniform block'
}

/**
 * Filters the lines of **one** request. The scope matters: repetition within a
 * segment is a sign of hallucination, but the same sentence reappearing over an
 * hour-long meeting may be legitimate.
 */
export function filterHallucinations(lines: TranscriptLine[]): FilterResult {
  if (lines.length === 0) return { lines, removed: 0 }

  const before = lines.length

  // 1. Uniform block: almost everything identical, length irrelevant.
  const counts = new Map<string, number>()
  for (const line of lines) {
    const key = normalize(line.text)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const mostCommon = Math.max(...counts.values())
  if (lines.length >= BLOCK_MIN_LINES && mostCommon / lines.length >= BLOCK_UNIFORMITY) {
    return { lines: [], removed: before, reason: 'uniform block' }
  }

  // 2. Known artifacts.
  let kept = lines.filter((line) => !ARTIFACTS.some((re) => re.test(line.text)))
  const afterArtifacts = kept.length

  // 3. Repeated long text: drop every occurrence, not just the extras — when
  //    Whisper gets stuck on a sentence, the first one is made up too.
  const longRepeats = new Set(
    [...counts.entries()]
      .filter(([text, n]) => n >= MIN_REPEAT_COUNT && text.length >= MIN_REPEAT_LENGTH)
      .map(([text]) => text)
  )
  if (longRepeats.size > 0) {
    kept = kept.filter((line) => !longRepeats.has(normalize(line.text)))
  }

  const removed = before - kept.length
  if (removed === 0) return { lines: kept, removed: 0 }

  return {
    lines: kept,
    removed,
    reason: afterArtifacts < before ? 'artifact' : 'repetition'
  }
}
