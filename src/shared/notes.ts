/**
 * Timestamped notes.
 *
 * A note's value isn't just its text: it's the *moment* in the conversation when
 * it was written. Aligning notes with the transcript gives the model a much
 * stronger signal than sending the notes as a loose block.
 */

/** A note line and the moment it came into existence. */
export interface NoteLine {
  text: string
  /**
   * Milliseconds since the start of the recording. Absent when the line was
   * written outside a meeting in progress (later editing), in which case there
   * is no moment to anchor it to.
   */
  atMs?: number
}

/** Minimum characters before risking a prefix match. */
const MIN_PREFIX_MATCH = 3

/**
 * Reconciles the new notes text with the timestamps already known.
 *
 * The goal is for each line to keep the moment it **started** being written,
 * and hold on to it afterwards. Two behaviors need care:
 *
 * - **Progressive typing.** Each save sees the line a bit longer. Comparing
 *   only by equality, the line would look new on every keystroke and the stamp
 *   would move along with it — recording when the user finished, not when the
 *   topic was being discussed.
 * - **Later correction.** Fixing a typo in a note from five minutes ago must
 *   not bring its stamp to the present.
 *
 * Both cases are solved by accepting a prefix relationship between the old and
 * the new line, in addition to exact equality.
 *
 * @param previous already-stamped lines, in their previous order
 * @param nextText current full text of the editor
 * @param nowMs    current recording time; `undefined` outside a meeting
 */
export function alignNoteStamps(
  previous: NoteLine[],
  nextText: string,
  nowMs: number | undefined
): NoteLine[] {
  const texts = nextText.replace(/\r\n/g, '\n').split('\n')
  const stamps: (number | undefined)[] = new Array(texts.length).fill(undefined)
  const matched = new Array(texts.length).fill(false)
  const used = new Set<number>()

  // A blank line carries no information; it uses no match and gets no stamp.
  const isBlank = (s: string): boolean => s.trim().length === 0
  for (let i = 0; i < texts.length; i++) {
    if (isBlank(texts[i])) matched[i] = true
  }

  // Pass 1, exact. Done in its own sweep so an earlier line doesn't consume, by
  // prefix, the exact match another line needed.
  for (let i = 0; i < texts.length; i++) {
    if (matched[i]) continue
    const j = closestUnused(previous, used, i, (p) => p.text === texts[i])
    if (j !== -1) {
      used.add(j)
      matched[i] = true
      stamps[i] = previous[j].atMs
    }
  }

  // Pass 2, prefix: covers typing in progress and corrections.
  for (let i = 0; i < texts.length; i++) {
    if (matched[i]) continue
    const j = closestUnused(previous, used, i, (p) => sharePrefix(p.text, texts[i]))
    if (j !== -1) {
      used.add(j)
      matched[i] = true
      stamps[i] = previous[j].atMs
    }
  }

  // Pass 3: whatever is left is new content, stamped now.
  return texts.map((text, i) => {
    if (isBlank(text)) return { text }
    const atMs = stamps[i] ?? (matched[i] ? undefined : nowMs)
    return atMs === undefined ? { text } : { text, atMs }
  })
}

/**
 * Among the candidates that satisfy the predicate, returns the one whose index
 * is closest to `target` — breaking ties in favor of lines that didn't move,
 * instead of matching a distant repetition of the same text.
 */
function closestUnused(
  previous: NoteLine[],
  used: Set<number>,
  target: number,
  predicate: (line: NoteLine) => boolean
): number {
  let best = -1
  let bestDistance = Number.POSITIVE_INFINITY
  for (let j = 0; j < previous.length; j++) {
    if (used.has(j) || !predicate(previous[j])) continue
    const distance = Math.abs(j - target)
    if (distance < bestDistance) {
      best = j
      bestDistance = distance
    }
  }
  return best
}

/** One of the strings is a prefix of the other, with significant overlap. */
function sharePrefix(a: string, b: string): boolean {
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a]
  if (shorter.trim().length < MIN_PREFIX_MATCH) return false
  return longer.startsWith(shorter)
}

/** Plain notes text, to write to `notes.md` and export. */
export function noteLinesToText(lines: NoteLine[]): string {
  return lines.map((l) => l.text).join('\n')
}

/** Only the lines with content and a stamp, in time order. */
export function stampedNotes(lines: NoteLine[]): Required<NoteLine>[] {
  return lines
    .filter((l): l is Required<NoteLine> => l.atMs !== undefined && l.text.trim().length > 0)
    .sort((a, b) => a.atMs - b.atMs)
}
