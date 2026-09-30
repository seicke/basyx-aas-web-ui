import type {
  EdcApiKeyAuthConfig,
  EdcManagementAuthConfig,
  EdcManagementAuthMode,
  EdcOAuth2ClientCredentialsAuthConfig,
  EdcProxyConfig,
} from './types.js'
import { createHttpError } from './httpError.js'

export interface EdcManagementAuthProvider {
  readonly mode: EdcManagementAuthMode
  getAuthHeaders: () => Promise<Record<string, string>>
}

export interface EdcManagementAuthProviderOptions {
  fetchFn?: typeof fetch
  requestTimeoutMs?: number
  now?: () => number
}

interface CachedAccessToken {
  headerValue: string
  expiresAt: number
}

interface TokenResponsePayload {
  access_token?: unknown
  expires_in?: unknown
}

const defaultRequestTimeoutMs = 30_000
const tokenRefreshSkewMs = 30_000
const fallbackTokenLifetimeMs = 300_000

const providersByProxy = new WeakMap<EdcProxyConfig, WeakMap<typeof fetch, EdcManagementAuthProvider>>()

export function isManagementAuthConfigured (auth: EdcManagementAuthConfig | undefined): boolean {
  if (!auth) {
    return false
  }

  return auth.mode === 'api-key'
    ? auth.apiKey !== ''
    : auth.tokenServerEndpoint !== '' && auth.clientId !== '' && auth.clientSecret !== ''
}

/**
 * Providers are cached per proxy config object and fetch implementation, so OAuth2 access tokens survive
 * across requests while callers that inject their own fetch get a separate token cache.
 */
export function getManagementAuthProvider (
  proxy: EdcProxyConfig,
  fetchFn: typeof fetch = fetch,
): EdcManagementAuthProvider {
  let providersByFetch = providersByProxy.get(proxy)
  if (!providersByFetch) {
    providersByFetch = new WeakMap()
    providersByProxy.set(proxy, providersByFetch)
  }

  const cachedProvider = providersByFetch.get(fetchFn)
  if (cachedProvider) {
    return cachedProvider
  }

  const provider = createManagementAuthProvider(proxy.auth, {
    fetchFn,
    requestTimeoutMs: proxy.requestTimeoutMs,
  })
  providersByFetch.set(fetchFn, provider)
  return provider
}

export function createManagementAuthProvider (
  auth: EdcManagementAuthConfig,
  options: EdcManagementAuthProviderOptions = {},
): EdcManagementAuthProvider {
  return auth.mode === 'api-key'
    ? createApiKeyAuthProvider(auth)
    : createOAuth2ClientCredentialsAuthProvider(auth, options)
}

function createApiKeyAuthProvider (auth: EdcApiKeyAuthConfig): EdcManagementAuthProvider {
  const headers = { [auth.apiKeyHeader]: auth.apiKey }

  return {
    mode: 'api-key',
    getAuthHeaders: () => Promise.resolve({ ...headers }),
  }
}

function createOAuth2ClientCredentialsAuthProvider (
  auth: EdcOAuth2ClientCredentialsAuthConfig,
  options: EdcManagementAuthProviderOptions,
): EdcManagementAuthProvider {
  const fetchFn = options.fetchFn ?? fetch
  const requestTimeoutMs = options.requestTimeoutMs ?? defaultRequestTimeoutMs
  const now = options.now ?? Date.now
  const credentials = Buffer.from(`${auth.clientId}:${auth.clientSecret}`).toString('base64')

  let cachedToken: CachedAccessToken | undefined
  let pendingToken: Promise<CachedAccessToken> | undefined

  async function resolveToken (): Promise<CachedAccessToken> {
    if (cachedToken && cachedToken.expiresAt > now()) {
      return cachedToken
    }

    // A single in-flight request is shared so parallel EDC calls do not hammer the token server.
    pendingToken ??= requestAccessToken(auth.tokenServerEndpoint, credentials, fetchFn, requestTimeoutMs, now)
      .finally(() => {
        pendingToken = undefined
      })

    cachedToken = await pendingToken
    return cachedToken
  }

  return {
    mode: 'oauth2-client-credentials',
    getAuthHeaders: async () => ({ Authorization: (await resolveToken()).headerValue }),
  }
}

async function requestAccessToken (
  tokenServerEndpoint: string,
  credentials: string,
  fetchFn: typeof fetch,
  requestTimeoutMs: number,
  now: () => number,
): Promise<CachedAccessToken> {
  const response = await postTokenRequest(tokenServerEndpoint, credentials, fetchFn, requestTimeoutMs)

  if (!response.ok) {
    const errorCode = await readOAuthErrorCode(response)
    const errorSuffix = errorCode ? ` (error: ${errorCode})` : ''

    if (response.status === 401 || response.status === 403 || errorCode === 'invalid_client') {
      throw createHttpError(
        `EDC OAuth2 token endpoint rejected the configured client credentials with HTTP ${response.status}${errorSuffix}`,
        502,
      )
    }

    throw createHttpError(`EDC OAuth2 token endpoint responded with HTTP ${response.status}${errorSuffix}`, 502)
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw createHttpError('EDC OAuth2 token endpoint returned a body that is not valid JSON', 502)
  }

  const tokenResponse = payload as TokenResponsePayload | null
  const accessToken = typeof tokenResponse?.access_token === 'string' ? tokenResponse.access_token.trim() : ''
  if (accessToken === '') {
    throw createHttpError('EDC OAuth2 token endpoint response did not contain an access_token', 502)
  }

  return {
    headerValue: accessToken,
    expiresAt: now() + resolveTokenLifetimeMs(tokenResponse?.expires_in),
  }
}

/** Reads only the RFC 6749 `error` code; the free-text `error_description` is not passed on. */
async function readOAuthErrorCode (response: Response): Promise<string | undefined> {
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    return undefined
  }

  const errorCode = (payload as { error?: unknown } | null)?.error
  return typeof errorCode === 'string' && /^[\w.-]{1,64}$/.test(errorCode) ? errorCode : undefined
}

async function postTokenRequest (
  tokenServerEndpoint: string,
  credentials: string,
  fetchFn: typeof fetch,
  requestTimeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs)

  try {
    return await fetchFn(tokenServerEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${credentials}`,
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
      signal: controller.signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw createHttpError(`EDC OAuth2 token request timed out after ${requestTimeoutMs} ms`, 504)
    }

    throw createHttpError(
      `EDC OAuth2 token request failed: ${error instanceof Error ? error.message : String(error)}`,
      502,
    )
  } finally {
    clearTimeout(timeout)
  }
}

function resolveTokenLifetimeMs (expiresIn: unknown): number {
  const lifetimeSeconds = Number(expiresIn)
  if (!Number.isFinite(lifetimeSeconds) || lifetimeSeconds <= 0) {
    return fallbackTokenLifetimeMs
  }

  // Short-lived tokens use half their lifetime as skew, so every token is refreshed before it expires.
  const lifetimeMs = lifetimeSeconds * 1000
  return lifetimeMs - Math.min(tokenRefreshSkewMs, lifetimeMs / 2)
}
