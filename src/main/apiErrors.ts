/**
 * Translates OpenAI errors into something the user understands and can act on.
 *
 * The raw API text ("429 You exceeded your current quota, please check your
 * plan and billing details...") went straight to the meeting screen and said
 * neither what happened to the recording nor what to do. Here each known case
 * becomes a sentence in the user's language with the next step. Errors we don't
 * recognize — and the ones Yogurt itself throws, already localized — pass
 * through unchanged.
 */
import { msgs } from '@shared/i18n'

interface ApiErrorShape {
  status?: number
  code?: string | null
  type?: string
  message?: string
  name?: string
}

function shape(err: unknown): ApiErrorShape {
  if (!err || typeof err !== 'object') return { message: String(err) }
  const e = err as Record<string, unknown>
  return {
    status: typeof e.status === 'number' ? e.status : undefined,
    code: typeof e.code === 'string' ? e.code : undefined,
    type: typeof e.type === 'string' ? e.type : undefined,
    message: typeof e.message === 'string' ? e.message : String(err),
    name: typeof e.name === 'string' ? e.name : undefined
  }
}

/** Credits exhausted or spending cap reached — retrying doesn't help. */
export function isQuotaExhausted(err: unknown): boolean {
  const e = shape(err)
  return (
    e.code === 'insufficient_quota' ||
    e.type === 'insufficient_quota' ||
    e.code === 'billing_hard_limit_reached' ||
    /exceeded your current quota|billing hard limit|insufficient_quota/i.test(e.message ?? '')
  )
}

/**
 * @param withRecovery appends the "nothing was lost…" sentence. Outside a
 *   meeting (e.g. testing the key in Settings) it makes no sense.
 */
export function friendlyError(err: unknown, withRecovery = true): string {
  const e = shape(err)
  const raw = e.message ?? ''
  const m = msgs().main.apiErrors
  const withNextStep = (text: string): string =>
    withRecovery ? `${text} ${m.recovery}` : text

  if (isQuotaExhausted(err)) return withNextStep(m.quota)

  if (e.status === 401 || e.code === 'invalid_api_key') return withNextStep(m.invalidKey)

  if (e.status === 403) return withNextStep(m.forbidden)

  if (e.status === 429) return withNextStep(m.rateLimited)

  if (e.status !== undefined && e.status >= 500) return withNextStep(m.serverError)

  if (
    /APIConnection(Timeout)?Error/.test(e.name ?? '') ||
    /connection error|ENOTFOUND|ECONNRESET|ETIMEDOUT|ERR_INTERNET|ERR_NAME_NOT_RESOLVED|timed out/i.test(
      raw
    )
  ) {
    return withNextStep(m.connection)
  }

  return raw
}
