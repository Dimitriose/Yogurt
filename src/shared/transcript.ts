import type { TranscriptLine } from './types'
import { OTHERS_SPEAKER, SELF_SPEAKER, isAnonymousSpeaker, speakerLabelKey } from './types'
import { msgs } from './i18n'

/**
 * Display text for the fixed channel labels, which are stored in Portuguese
 * (`Eu`/`Outros`). `Others` covers transcripts written while the label was
 * briefly stored localized.
 */
function channelLabel(speaker: string): string | null {
  const s = msgs().system.speakers
  if (speaker === SELF_SPEAKER) return s.me
  if (speaker === OTHERS_SPEAKER || speaker === 'Others') return s.others
  return null
}

/**
 * How a speaker should appear on screen and in the prompt.
 *
 * Precedence: name the user assigned in this meeting > name that came from the
 * API > anonymous label.
 */
export interface ResolvedSpeaker {
  /** Text to display. */
  label: string
  /** Whether it's still an anonymous label, with no known identity. */
  anonymous: boolean
  /** Whether the name came from the user's manual assignment in this meeting. */
  assigned: boolean
}

export function resolveSpeaker(
  line: TranscriptLine,
  speakerNames?: Record<string, string>
): ResolvedSpeaker | null {
  if (!line.speaker) return null

  const key = speakerLabelKey(line.segmentIndex, line.speaker)
  const assigned = speakerNames?.[key]
  if (assigned) return { label: assigned, anonymous: false, assigned: true }

  if (!isAnonymousSpeaker(line.speaker)) {
    // A fixed channel label, or a name the API itself returned instead of an
    // anonymous letter.
    const label = channelLabel(line.speaker) ?? line.speaker
    return { label, anonymous: false, assigned: false }
  }

  // Anonymous: the block goes along because the letter is only valid within it.
  const block = line.segmentIndex !== undefined ? `·${line.segmentIndex + 1}` : ''
  return { label: `${line.speaker}${block}`, anonymous: true, assigned: false }
}

/**
 * Merges consecutive utterances by the same speaker into a single turn.
 *
 * **Why.** With diarization, overlapping speech arrives interleaved and
 * chopped up. A "com certeza" ("for sure") said over whoever is talking
 * becomes:
 *
 *     [A] Com
 *     [B] É
 *     [A] certeza.
 *     [B] uma questão simplesmente do estágio da vida,
 *
 * Faithful to the audio, and unreadable. Grouping by speaker within a short
 * window:
 *
 *     [A] Com certeza.
 *     [B] É uma questão simplesmente do estágio da vida,
 *
 * This matters for the screen and, even more, for the minutes prompt:
 * fragmented text degrades the summary.
 *
 * Chronological order is preserved — each turn sits at the position of its
 * first fragment. It only merges within the same transcription block, because
 * anonymous labels (`A`, `B`) aren't comparable across blocks.
 *
 * Caution: the `[start, end]` range of a merged turn **spans the other
 * participant's speech**, so it can't be used to locate one person's speech in
 * isolation. Use the raw lines for that.
 */
export interface CoalesceOptions {
  /**
   * Maximum silence, in seconds, for the speaker to resume the same turn.
   * Tight on purpose: it only rejoins real fragments ("Com" … "certeza."),
   * without stitching together utterances separated by the other participant's
   * reply.
   */
  maxGapSec?: number
  /** Maximum duration of a turn. */
  maxTurnSec?: number
  /** Maximum word count of a turn. */
  maxTurnWords?: number
}

/**
 * Without the caps, a dominant speaker became a single 195s, 499-word turn —
 * trading fragmentation for a wall of text. Worse: the other participant's
 * interjections that happened *inside* that range showed up after it, making
 * the reading order misleading.
 */
const DEFAULTS: Required<CoalesceOptions> = {
  maxGapSec: 1,
  maxTurnSec: 40,
  maxTurnWords: 120
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

export function coalesceTurns(
  lines: TranscriptLine[],
  options: CoalesceOptions = {}
): TranscriptLine[] {
  const { maxGapSec, maxTurnSec, maxTurnWords } = { ...DEFAULTS, ...options }
  const out: TranscriptLine[] = []
  // Last position in `out` taken by each (block, speaker).
  const lastIndex = new Map<string, number>()

  for (const line of lines) {
    // Without a speaker label there's nothing to group: whisper-1 lines already
    // come at sentence level.
    if (!line.speaker) {
      out.push({ ...line })
      lastIndex.clear()
      continue
    }

    const key = `${line.segmentIndex ?? 0}:${line.speaker}`
    const prev = lastIndex.get(key)

    if (prev !== undefined) {
      const open = out[prev]
      const withinGap = line.start - open.end <= maxGapSec
      const withinDuration = line.end - open.start <= maxTurnSec
      const withinWords = countWords(open.text) + countWords(line.text) <= maxTurnWords

      if (withinGap && withinDuration && withinWords) {
        out[prev] = {
          ...open,
          end: Math.max(open.end, line.end),
          text: `${open.text} ${line.text}`.trim()
        }
        continue
      }
    }

    out.push({ ...line })
    lastIndex.set(key, out.length - 1)
  }

  return out
}
