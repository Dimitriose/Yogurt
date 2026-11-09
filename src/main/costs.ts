import { existsSync, readdirSync } from 'node:fs'
import type { AudioSource } from '@shared/types'
import * as store from './store'
import { getPublicSettings } from './settings'
import { transcriptToText } from './prompts'
import { findTextModel, type CostEstimate } from '@shared/models'

/**
 * Cost estimate for the actions that resend data to the API.
 *
 * It exists because "Retranscribe" resends **every** segment: on a one-hour
 * meeting that costs the same as recording it again. An accidental click with
 * no warning is money spent silently.
 */

/** OpenAI list price, per minute of audio. */
const AUDIO_USD_PER_MIN = 0.006

/**
 * The diarized channel costs more than the list price.
 *
 * The published $0.006/min is an *estimate* for a normal speaking pace; actual
 * billing is per token, and `diarized_json` spends output on
 * `speaker`/`start`/`end` for every segment. Reconciling the spend observed in
 * real use, the diarized channel came out at about double. We use double here
 * on purpose: in a cost warning, underestimating is worse than overstating.
 */
const DIARIZE_MULTIPLIER = 2

/**
 * Price assumed when the chosen model has no known rate in the catalog.
 *
 * Uses gpt-4o, the most expensive one we have ever supported, on purpose: in a
 * cost warning, overstating is safe and underestimating is not. The on-screen
 * warning says the value is an upper bound, so the number doesn't pass for
 * precision it doesn't have.
 */
const FALLBACK_USD_PER_MILLION = { input: 2.5, output: 10 }

/**
 * Portuguese tokenizes worse than English; ~3.6 chars/token is a useful
 * approximation. Kept for English too: overestimating tokens is the safe side
 * for a cost warning.
 */
const CHARS_PER_TOKEN = 3.6

/** Typical size of the minutes, in output tokens. */
const SUMMARY_OUTPUT_TOKENS = 700

/** Fixed prompt (minutes rules + guidance), in chars. */
const SYSTEM_PROMPT_CHARS = 3700

export type { CostEstimate }

function channelsOnDisk(meetingId: string): { files: number; sources: Set<AudioSource | 'legacy'> } {
  const dir = store.audioDirPath(meetingId)
  const sources = new Set<AudioSource | 'legacy'>()
  if (!existsSync(dir)) return { files: 0, sources }

  const files = readdirSync(dir).filter((f) => f.endsWith('.webm'))
  for (const file of files) {
    if (/-mic\.webm$/.test(file)) sources.add('mic')
    else if (/-system\.webm$/.test(file)) sources.add('system')
    else sources.add('legacy')
  }
  return { files: files.length, sources }
}

export function estimateCosts(meetingId: string): CostEstimate | null {
  const meta = store.readMeta(meetingId)
  if (!meta) return null

  const settings = getPublicSettings()
  const { files, sources } = channelsOnDisk(meetingId)
  const minutes = meta.durationMs / 60000

  // Each channel is a full pass over the audio, so the cost adds up per channel.
  let retranscribeUsd = 0
  for (const source of sources) {
    const diarized = settings.diarization && source !== 'mic'
    retranscribeUsd += minutes * AUDIO_USD_PER_MIN * (diarized ? DIARIZE_MULTIPLIER : 1)
  }

  const transcriptChars = transcriptToText(
    store.readTranscript(meetingId),
    meta.speakerNames
  ).length
  const notesChars = store.readNotes(meetingId).length
  const inputTokens = Math.ceil(
    (transcriptChars + notesChars + SYSTEM_PROMPT_CHARS) / CHARS_PER_TOKEN
  )

  // Comes from the catalog instead of an `if (model.includes('mini'))`: that
  // test classified any new model as gpt-4o without warning.
  const model = findTextModel(settings.summaryModel)
  const price = model?.usdPerMillion ?? FALLBACK_USD_PER_MILLION
  const pricingKnown = model?.usdPerMillion != null

  const regenerateUsd =
    (inputTokens * price.input + SUMMARY_OUTPUT_TOKENS * price.output) / 1e6

  return {
    audioFiles: files,
    channels: sources.size,
    retranscribeUsd,
    regenerateUsd,
    pricingKnown
  }
}
