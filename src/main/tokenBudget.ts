/**
 * Tokens-per-minute (TPM) budget for the text model.
 *
 * **Why it exists.** A real 98-min meeting failed with:
 *
 *     429 Request too large for gpt-4o ... tokens per min (TPM):
 *     Limit 30000, Requested 31406
 *
 * The app had a valve for long transcripts — `MAX_TRANSCRIPT_CHARS` — but it
 * was calibrated against gpt-4o's **context window** (128k tokens). The limit
 * that bites first is a different one: the *account's* TPM, which on smaller
 * accounts is 30k. The valve's 240k chars are ~62k tokens, more than twice the
 * ceiling — so it never fired before the 429.
 *
 * Calibrating against the model's context was the root mistake. What limits is
 * the plan of whoever pays, not the model.
 */

/**
 * Chars per token, measured — not estimated.
 *
 * The API reported 31,406 tokens for a 121,462-char prompt in pt-BR, which
 * gives 3.867. Portuguese spends more tokens per char than English (~4.0), and
 * using the English figure would underestimate the prompt by ~3%: exactly the
 * margin that overflowed.
 *
 * Rounded down on purpose: underestimating chars/token overestimates tokens,
 * and erring on the safe side here costs a little detail in the minutes, while
 * erring on the other side costs the whole minutes.
 *
 * Also used for English text: English tokenizes more efficiently, so the
 * Portuguese figure overestimates there too — the safe direction.
 */
export const CHARS_PER_TOKEN_PTBR = 3.8

/**
 * TPM ceiling assumed when the user hasn't entered theirs.
 *
 * 30,000 is the gpt-4o limit on first-tier accounts, and it is what the real
 * account where the bug showed up has. Assuming a high ceiling by default would
 * bring the bug back for anyone with a small account; assuming a low one only
 * condenses earlier than necessary for those with a large account — and that
 * person can raise it in Settings.
 */
export const DEFAULT_TPM_LIMIT = 30_000

/**
 * Fraction of the ceiling we accept occupying in one request.
 *
 * It isn't 100% because TPM counts input **and output**, and the generated
 * minutes weigh too: long minutes may exceed 2,000 tokens. Also, the API's
 * count is a sliding window, so an earlier request may still be inside it.
 * 70% covers both effects without needlessly shrinking the minutes.
 */
export const BUDGET_FRACTION = 0.7

export interface PromptBudget {
  /** Input tokens a request may use. */
  maxInputTokens: number
  /** The same, converted to chars — the unit we cut text in. */
  maxInputChars: number
}

export function promptBudget(tpmLimit: number): PromptBudget {
  const maxInputTokens = Math.floor(tpmLimit * BUDGET_FRACTION)
  return {
    maxInputTokens,
    maxInputChars: Math.floor(maxInputTokens * CHARS_PER_TOKEN_PTBR)
  }
}

/** Token estimate for a text (calibrated on pt-BR; conservative for English). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN_PTBR)
}

/**
 * Extracts the real TPM ceiling from the 429 error message.
 *
 * The API states the account's limit in the error text. Reading it from there
 * is the only way to know the true value without asking the user to look it up
 * in the OpenAI dashboard — and it is the data that turns "it failed" into
 * "adjust this".
 */
export function parseTpmLimit(message: string): number | null {
  // "... on tokens per min (TPM): Limit 30000, Requested 31406 ..."
  const match = /tokens per min[^:]*:\s*Limit\s+(\d+)/i.exec(message)
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) && value > 0 ? value : null
}

/**
 * Recognizes the 429 that is **not** worth retrying.
 *
 * OpenAI uses 429 for two different cases: "you sent too fast", which a new
 * attempt fixes, and "this request is too large for your ceiling", which no
 * attempt fixes — the prompt has to shrink. The SDK client retries 3 times by
 * default, which in the second case only delays the error.
 */
export function isRequestTooLarge(message: string): boolean {
  return /request too large/i.test(message) && /tokens per min|TPM/i.test(message)
}

/** TPM window, in ms. OpenAI counts over a sliding minute. */
const WINDOW_MS = 60_000

/**
 * Spaces text calls out so the per-minute total fits the ceiling.
 *
 * **Why shrinking each request isn't enough.** Shrinking fixes an isolated
 * call, but condensation makes several in a row. Two 15k-token parts each fit
 * a 30k ceiling and overflow together — which is exactly the scenario of the
 * 98-min meeting after being split in two. Without spacing, fixing the size
 * only moves the 429 elsewhere.
 *
 * Implemented as a sliding window and not as a fixed interval between calls: a
 * fixed interval would penalize short meetings, which are the majority and
 * never come close to the ceiling.
 */
export class TpmGate {
  private recent: Array<{ at: number; tokens: number }> = []

  constructor(
    private limit: number,
    /**
     * Injectable clock and sleep, so the test runs without waiting a real
     * minute. Both together, not just the sleep: a fake `sleep` without a fake
     * clock leaves the loop spinning idle, because time never advances enough
     * to free the window.
     */
    private sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((r) => setTimeout(r, ms)),
    private now: () => number = () => Date.now()
  ) {}

  /** Updates the ceiling when the API reveals the real value in a 429. */
  setLimit(limit: number): void {
    this.limit = limit
  }

  private prune(now: number): void {
    this.recent = this.recent.filter((r) => now - r.at < WINDOW_MS)
  }

  private used(now: number): number {
    this.prune(now)
    return this.recent.reduce((sum, r) => sum + r.tokens, 0)
  }

  /**
   * Waits, if needed, until `tokens` fit in the window; then records the spend.
   *
   * Records before the call, not after, because what we need to prevent is
   * concurrent *sending*. A request in flight has already consumed the budget
   * from the API's point of view.
   */
  async reserve(tokens: number): Promise<void> {
    // 5% margin: the token estimate is imprecise, and output also counts toward TPM.
    const ceiling = this.limit * 0.95

    // Wait cap. Without it the loop is unbounded: if waiting doesn't advance
    // time as expected, it spins idle — which is what a test with a stopped
    // clock exposed, spinning hundreds of millions of times. Two windows are
    // enough for any legitimate case; beyond that it's better to send and let
    // the API answer than to block minutes generation forever.
    const deadline = this.now() + WINDOW_MS * 2

    for (;;) {
      const now = this.now()
      // Nothing recorded: even a request above the ceiling has to go through,
      // or it would be stuck here waiting for a window that will never free up.
      if (this.used(now) + tokens <= ceiling || this.recent.length === 0) break
      if (now >= deadline) {
        console.warn('[tpm] wait exceeded the cap; sending and letting the API decide')
        break
      }

      // Wait only until the oldest request leaves the window — the minimum that
      // can free up room. Re-evaluate afterwards, since one exit may not suffice.
      const oldest = this.recent[0]
      const wait = Math.max(50, WINDOW_MS - (now - oldest.at) + 50)
      await this.sleep(Math.min(wait, deadline - now))
    }

    this.recent.push({ at: this.now(), tokens })
  }

  /** For diagnostics and tests only. */
  usedNow(): number {
    return this.used(this.now())
  }
}
