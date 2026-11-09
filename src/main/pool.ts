/**
 * Execution with bounded concurrency.
 *
 * Exists because of retranscription: it used to fire `Promise.allSettled` over
 * *all* audio files at once. In a 19-min meeting that's 12 requests and goes
 * unnoticed; in a 3-hour one with 3-min blocks it's 120 simultaneous ~1 MB
 * uploads, which blows OpenAI's requests-per-minute limit. The result is a
 * flood of 429s and most blocks failing — precisely in the action the user
 * triggers to *fix* a long meeting.
 *
 * Live recording never had this problem because it is naturally spaced out:
 * two blocks every few minutes.
 */

/**
 * How many audio requests are in flight at once.
 *
 * Four because it's conservative enough to fit the smaller account limits
 * without serializing the work: a 3-hour meeting goes out in ~30 rounds instead
 * of 120 at once, and the client's `maxRetries` absorbs an occasional 429.
 */
export const TRANSCRIBE_CONCURRENCY = 4

/**
 * Runs `worker` over `items` with at most `limit` in parallel, preserving the
 * order of the results.
 *
 * Never rejects: each item yields `{ ok }` or `{ error }`, like
 * `Promise.allSettled` — one failing block must not take down the others.
 */
export async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<Array<{ ok: true; value: R } | { ok: false; error: unknown }>> {
  const results = new Array<{ ok: true; value: R } | { ok: false; error: unknown }>(
    items.length
  )
  let next = 0

  // Each "worker" pulls the next free index until the queue runs out. This keeps
  // `limit` requests in flight even with uneven durations — which fixed-size
  // batches wouldn't, because a batch only advances when its slowest item ends.
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++
      if (index >= items.length) return
      try {
        results[index] = { ok: true, value: await worker(items[index], index) }
      } catch (error) {
        results[index] = { ok: false, error }
      }
    }
  })

  await Promise.all(runners)
  return results
}
