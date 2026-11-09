/**
 * Catalog of the text models used for minutes and titles.
 *
 * **Why it exists.** Each model's information was spread across three places
 * that had to agree and didn't: the picker list in `SettingsView`, the price in
 * `costs.ts` (an `if (model.includes('mini'))`, which classified any new model
 * as gpt-4o) and the TPM ceiling, which was a global setting — when the limit
 * is actually **per model**.
 *
 * That last point broke in practice: `gpt-4o` has 30,000 TPM on the first tier
 * and `gpt-5.6-luna` has 200,000. Switching models without switching the
 * ceiling would make the app condense the transcript needlessly, delivering
 * worse minutes because of a limit that no longer applies.
 */

import { msgs } from './i18n'

export interface TextModel {
  id: string
  /**
   * Picker text. Entries with a description are getters that read the active
   * language, so the shape stays a plain `string` for callers.
   */
  label: string
  /**
   * Tokens per minute on the **first** account tier, which is the known case.
   * Larger accounts have more, and the user can override it in Settings.
   */
  tier1Tpm: number
  /**
   * Price per 1 million tokens, in dollars. `null` when unknown — see
   * `pricingKnown` in `costs.ts`, which handles that case conservatively instead
   * of faking precision.
   */
  usdPerMillion: { input: number; output: number } | null
}

export const TEXT_MODELS: TextModel[] = [
  {
    id: 'gpt-5.6-luna',
    get label() {
      return msgs().system.models.luna
    },
    tier1Tpm: 200_000,
    // Not known in this codebase. See the note in costs.ts.
    usdPerMillion: null
  },
  {
    id: 'gpt-5.6-sol',
    label: 'gpt-5.6-sol',
    tier1Tpm: 500_000,
    usdPerMillion: null
  },
  {
    id: 'gpt-5.6-terra',
    label: 'gpt-5.6-terra',
    tier1Tpm: 500_000,
    usdPerMillion: null
  },
  {
    id: 'gpt-4o',
    get label() {
      return msgs().system.models.gpt4o
    },
    tier1Tpm: 30_000,
    usdPerMillion: { input: 2.5, output: 10 }
  },
  {
    id: 'gpt-4o-mini',
    get label() {
      return msgs().system.models.gpt4oMini
    },
    // Not confirmed in the account dashboard; kept conservative on purpose.
    tier1Tpm: 200_000,
    usdPerMillion: { input: 0.15, output: 0.6 }
  },
  {
    id: 'gpt-4.1',
    label: 'gpt-4.1',
    tier1Tpm: 30_000,
    usdPerMillion: { input: 2, output: 8 }
  }
]

export function findTextModel(id: string): TextModel | undefined {
  return TEXT_MODELS.find((m) => m.id === id)
}

/**
 * Known TPM ceiling for a model, or `null` if the model isn't in the catalog —
 * in which case we keep what the user configured instead of overwriting it with
 * a guess.
 */
export function tier1TpmFor(id: string): number | null {
  return findTextModel(id)?.tier1Tpm ?? null
}

/**
 * Cost estimate of the actions that resend data to the API.
 *
 * Lives here, not in `main/costs.ts`, because the type used to be declared
 * three times — in `costs.ts`, in `api.ts` and again inside `MeetingView` — and
 * the three copies had to be kept in agreement by hand. Adding `pricingKnown`
 * broke two of them, which is exactly the symptom of type duplication.
 */
export interface CostEstimate {
  /** Audio files still on disk. */
  audioFiles: number
  /** Distinct channels found (microphone, system). */
  channels: number
  /** Approximate cost of resending all audio to the API. */
  retranscribeUsd: number
  /** Cost of rewriting the minutes from what's already transcribed. */
  regenerateUsd: number
  /**
   * Whether the chosen model's rate is known. When false, `regenerateUsd` is an
   * upper bound computed with gpt-4o's price, and the UI says so instead of
   * presenting the number as an estimate.
   */
  pricingKnown: boolean
}
