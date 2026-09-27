const TILE_ORIGIN = 'https://tile.googleapis.com'
const TILE_PATH = '/v1/3dtiles/'

// Google tiles contain both absolute and root-relative child URIs. Resolve every
// child against the tile service, preserving Google's session query parameters.
export function createGoogleTileFetch(key: string, proxyOrigin?: string, onUnavailable?: (reason: string) => void) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const source = new URL(raw, `${TILE_ORIGIN}${TILE_PATH}`)
    const isTile = source.pathname.startsWith(TILE_PATH) &&
      (source.origin === TILE_ORIGIN || source.origin === proxyOrigin)
    // Never attach the Maps key to third-party or embedded glTF resources.
    if (!isTile) return fetch(input, init)

    const target = new URL(`${source.pathname}${source.search}`, proxyOrigin || TILE_ORIGIN)
    const request = new Request(target, input instanceof Request ? input : undefined)
    const headers = new Headers(init?.headers ?? request.headers)
    headers.set('X-GOOG-API-KEY', key)
    try {
      const response = await fetch(request, { ...init, headers })
      if (!response.ok) {
        if ([401, 403, 429].includes(response.status) || source.pathname === `${TILE_PATH}root.json`) {
          onUnavailable?.([401, 403].includes(response.status)
            ? 'Google Maps access was denied.'
            : 'Google Maps is temporarily unavailable.')
        }
        throw new Error(`Google map tile request failed (${response.status})`)
      }
      return response
    } catch (error) {
      if (source.pathname === `${TILE_PATH}root.json`) onUnavailable?.('Google Maps could not be reached.')
      throw error
    }
  }
}
