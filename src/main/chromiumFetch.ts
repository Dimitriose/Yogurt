import { net } from 'electron'

/**
 * `fetch` for the OpenAI SDK that uses Chromium's network stack instead of
 * Node's.
 *
 * **Why.** Node's `fetch` (undici) validates certificates against the CA bundle
 * compiled into Node itself and ignores the system store. On a corporate network
 * with TLS inspection every call dies with `SELF_SIGNED_CERT_IN_CHAIN`.
 * Electron's `net.fetch` trusts the Windows certificate store and honors the
 * system proxy.
 *
 * Two incompatibilities had to be worked around, both verified empirically
 * against the real API:
 *
 * 1. **Streaming body.** The SDK builds the audio multipart as a stream.
 *    `net.fetch` rejects a streaming body with `ERR_INVALID_ARGUMENT` (and
 *    before that demands `duplex: 'half'`, which doesn't help either). We
 *    consume the stream and send it buffered — an Opus segment is 1–2 MB, so
 *    the memory cost is irrelevant.
 *
 * 2. **`content-length`.** It's a forbidden header in the Fetch spec. Browsers
 *    drop it silently; `net.fetch` fails with `ERR_INVALID_ARGUMENT`. The SDK
 *    sets it on uploads, so we remove it and let Chromium recompute it.
 */

/** The main process's `lib` doesn't include DOM; derive from what @types/node exposes. */
type FetchBody = RequestInit['body']

export async function chromiumFetch(url: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers ?? {})
  headers.delete('content-length')

  const body = await bufferBody(init?.body)

  return net.fetch(url, { ...init, headers, body })
}

/**
 * Consumes streaming bodies, leaving other types untouched. Covers both
 * `ReadableStream` (web) and async iterables (Node's `Readable`), because the
 * shape the SDK produces varies with the version and the endpoint.
 */
async function bufferBody(body: FetchBody): Promise<FetchBody> {
  if (!body || typeof body === 'string') return body

  const candidate = body as {
    getReader?: () => { read: () => Promise<{ done: boolean; value?: Uint8Array }> }
    [Symbol.asyncIterator]?: () => AsyncIterator<Uint8Array>
  }

  if (typeof candidate.getReader === 'function') {
    const reader = candidate.getReader()
    const chunks: Buffer[] = []
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) chunks.push(Buffer.from(value))
    }
    return Buffer.concat(chunks) as unknown as FetchBody
  }

  if (typeof candidate[Symbol.asyncIterator] === 'function') {
    const chunks: Buffer[] = []
    for await (const chunk of body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk))
    }
    return Buffer.concat(chunks) as unknown as FetchBody
  }

  return body
}
