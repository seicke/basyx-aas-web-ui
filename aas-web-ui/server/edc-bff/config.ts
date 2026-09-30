import type {
  EdcBffAuthConfig,
  EdcBffAuthMode,
  EdcBffRuntimeConfig,
  EdcManagementAuthConfig,
  EdcProxyConfig,
  RedactedEdcProxyConfig,
} from './types.js'
import { readFileSync } from 'node:fs'
import { isManagementAuthConfigured } from './managementAuth.js'

type Env = NodeJS.ProcessEnv
type FileReader = (path: string, encoding: BufferEncoding) => string

interface RawProxyConfig {
  id?: unknown
  managementUrl?: unknown
  apiKey?: unknown
  apiKeyHeader?: unknown
  tokenServerEndpoint?: unknown
  tokenServerClientId?: unknown
  tokenServerClientSecret?: unknown
  allowInsecureTokenServerEndpoint?: unknown
  participantId?: unknown
  dspEndpoint?: unknown
  dataPlaneProxyUrl?: unknown
  allowedCounterPartyAddresses?: unknown
  allowInsecureCounterPartyAddresses?: unknown
  requestTimeoutMs?: unknown
  edrPollingAttempts?: unknown
  edrPollingIntervalMs?: unknown
}

interface RawProxyConfigDocument {
  proxies?: Record<string, RawProxyConfig> | RawProxyConfig[]
}

const defaultProxyId = 'default'
const defaultApiKeyHeader = 'X-Api-Key'
const defaultRequestTimeoutMs = 30_000
const maxRequestTimeoutMs = 120_000
const defaultEdrPollingAttempts = 30
const defaultEdrPollingIntervalMs = 2000
const maxEdrPollingAttempts = 120
const maxEdrPollingIntervalMs = 30_000
const unsetIntegerValues = new Set<unknown>([undefined, null, ''])

export function loadRuntimeConfig (
  env: Env = process.env,
  readFile: FileReader = readFileSync,
): EdcBffRuntimeConfig {
  const auth = loadAuthConfig(env)
  const proxies = loadProxyConfigMap(env, readFile)

  return {
    port: parseInteger(env.CX_EDC_BFF_PORT, 3001, 1, 65_535),
    auth,
    proxies,
  }
}

export function loadAuthConfig (env: Env = process.env): EdcBffAuthConfig {
  const mode = normalizeAuthMode(env.CX_EDC_BFF_AUTH_MODE)
  const auth: EdcBffAuthConfig = {
    mode,
    issuer: trimToUndefined(env.CX_EDC_BFF_AUTH_ISSUER),
    audience: trimToUndefined(env.CX_EDC_BFF_AUTH_AUDIENCE),
    jwksUrl: trimToUndefined(env.CX_EDC_BFF_AUTH_JWKS_URL),
    requiredRoles: splitCsv(env.CX_EDC_BFF_REQUIRED_ROLES),
  }

  if (mode === 'jwt' && !auth.jwksUrl) {
    throw new Error('CX_EDC_BFF_AUTH_JWKS_URL is required when CX_EDC_BFF_AUTH_MODE=jwt')
  }

  return auth
}

export function loadProxyConfigMap (
  env: Env = process.env,
  readFile: FileReader = readFileSync,
): Map<string, EdcProxyConfig> {
  const rawProxies = new Map<string, RawProxyConfig>()

  for (const [id, rawProxy] of readConfiguredProxyEntries(env, readFile)) {
    rawProxies.set(id, rawProxy)
  }

  const shorthandProxy = readShorthandProxyConfig(env)
  if (shorthandProxy) {
    rawProxies.set(defaultProxyId, {
      ...rawProxies.get(defaultProxyId),
      ...shorthandProxy,
    })
  }

  const proxies = new Map<string, EdcProxyConfig>()
  for (const [id, rawProxy] of rawProxies) {
    const normalizedProxy = normalizeProxyConfig(id, rawProxy, env)
    if (normalizedProxy) {
      proxies.set(normalizedProxy.id, normalizedProxy)
    }
  }

  return proxies
}

export function redactProxyConfig (proxy: EdcProxyConfig | undefined, id: string): RedactedEdcProxyConfig {
  const authConfigured = isManagementAuthConfigured(proxy?.auth)

  return {
    id,
    configured: Boolean(proxy?.managementUrl) && authConfigured,
    managementUrlConfigured: Boolean(proxy?.managementUrl),
    authMode: proxy?.auth.mode,
    authConfigured,
    apiKeyConfigured: proxy?.auth.mode === 'api-key' && authConfigured,
    participantId: proxy?.participantId,
    dspEndpointConfigured: Boolean(proxy?.dspEndpoint),
    dataPlaneProxyUrlConfigured: Boolean(proxy?.dataPlaneProxyUrl),
    allowedCounterPartyAddressCount: proxy?.allowedCounterPartyAddresses.length ?? 0,
    allowInsecureCounterPartyAddresses: proxy?.allowInsecureCounterPartyAddresses ?? false,
  }
}

export function isCounterPartyAddressAllowed (proxy: EdcProxyConfig, address: string): boolean {
  const normalizedAddress = normalizeUrl(address)
  if (!normalizedAddress) {
    return false
  }

  if (normalizedAddress.protocol !== 'https:' && !proxy.allowInsecureCounterPartyAddresses) {
    return false
  }

  if (proxy.allowedCounterPartyAddresses.includes('*')) {
    return true
  }

  return proxy.allowedCounterPartyAddresses.some(allowedAddress => {
    const normalizedAllowedAddress = normalizeUrl(allowedAddress)
    if (!normalizedAllowedAddress) {
      return false
    }

    return matchesAllowedAddress(normalizedAddress, normalizedAllowedAddress)
  })
}

export function joinManagementUrl (proxy: EdcProxyConfig, path: string): string {
  const baseUrl = proxy.managementUrl.replace(/\/+$/, '')
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${baseUrl}${normalizedPath}`
}

function readConfiguredProxyEntries (env: Env, readFile: FileReader): Array<[string, RawProxyConfig]> {
  const jsonSources: string[] = []
  const configFile = trimToUndefined(env.CX_EDC_PROXY_CONFIG_FILE)

  if (configFile) {
    jsonSources.push(readFile(configFile, 'utf8'))
  }

  const inlineConfig = trimToUndefined(env.CX_EDC_PROXY_CONFIG_JSON)
  if (inlineConfig) {
    jsonSources.push(inlineConfig)
  }

  return jsonSources.flatMap(source => normalizeProxyDocument(JSON.parse(source)))
}

function normalizeProxyDocument (document: unknown): Array<[string, RawProxyConfig]> {
  const proxyDocument = document as RawProxyConfigDocument | Record<string, RawProxyConfig>
  const proxies = Object.hasOwn(proxyDocument, 'proxies')
    ? proxyDocument.proxies
    : proxyDocument

  if (Array.isArray(proxies)) {
    return proxies
      .map(rawProxy => [String(rawProxy.id ?? '').trim(), rawProxy] as [string, RawProxyConfig])
      .filter(([id]) => id !== '')
  }

  if (!proxies || typeof proxies !== 'object') {
    return []
  }

  return Object.entries(proxies as Record<string, RawProxyConfig>)
}

function readShorthandProxyConfig (env: Env): RawProxyConfig | undefined {
  const shorthandVariables = [
    env.CX_EDC_DEFAULT_MANAGEMENT_URL,
    env.CX_EDC_DEFAULT_API_KEY,
    env.CX_EDC_TOKEN_SERVER_ENDPOINT,
    env.CX_EDC_TOKEN_SERVER_CLIENT_ID,
    env.CX_EDC_TOKEN_SERVER_CLIENT_SECRET,
  ]

  if (shorthandVariables.every(value => !trimToUndefined(value))) {
    return undefined
  }

  return {
    managementUrl: env.CX_EDC_DEFAULT_MANAGEMENT_URL,
    apiKey: env.CX_EDC_DEFAULT_API_KEY,
    apiKeyHeader: env.CX_EDC_DEFAULT_API_KEY_HEADER,
    tokenServerEndpoint: env.CX_EDC_TOKEN_SERVER_ENDPOINT,
    tokenServerClientId: env.CX_EDC_TOKEN_SERVER_CLIENT_ID,
    tokenServerClientSecret: env.CX_EDC_TOKEN_SERVER_CLIENT_SECRET,
    participantId: env.CX_EDC_DEFAULT_PARTICIPANT_ID,
    dspEndpoint: env.CX_EDC_DEFAULT_DSP_ENDPOINT,
    dataPlaneProxyUrl: env.CX_EDC_DEFAULT_DATA_PLANE_PROXY_URL,
  }
}

function normalizeProxyConfig (
  id: string,
  rawProxy: RawProxyConfig,
  env: Env,
): EdcProxyConfig | undefined {
  const proxyId = String(rawProxy.id ?? id).trim()
  if (proxyId === '') {
    return undefined
  }

  const managementUrl = trimToUndefined(rawProxy.managementUrl) ?? ''
  const auth = resolveManagementAuthConfig(proxyId, rawProxy, env)
  if (managementUrl && !isManagementAuthConfigured(auth)) {
    throw new Error(
      `EDC proxy "${proxyId}" has a management URL but no EDC authentication. Set apiKey (CX_EDC_DEFAULT_API_KEY) `
      + 'for API key mode, or tokenServerEndpoint, tokenServerClientId, and tokenServerClientSecret '
      + '(CX_EDC_TOKEN_SERVER_*) for OAuth2 client credentials mode.',
    )
  }

  return {
    id: proxyId,
    managementUrl,
    auth,
    participantId: trimToUndefined(rawProxy.participantId),
    dspEndpoint: trimToUndefined(rawProxy.dspEndpoint),
    dataPlaneProxyUrl: trimToUndefined(rawProxy.dataPlaneProxyUrl),
    allowedCounterPartyAddresses: uniqueValues([
      ...splitCsv(env.CX_EDC_ALLOWED_COUNTER_PARTY_ADDRESSES),
      ...normalizeStringList(rawProxy.allowedCounterPartyAddresses),
    ]),
    allowInsecureCounterPartyAddresses:
      parseBoolean(rawProxy.allowInsecureCounterPartyAddresses)
      || parseBoolean(env.CX_EDC_ALLOW_INSECURE_COUNTER_PARTY_ADDRESSES),
    requestTimeoutMs: parseInteger(
      rawProxy.requestTimeoutMs ?? env.CX_EDC_REQUEST_TIMEOUT_MS,
      defaultRequestTimeoutMs,
      1000,
      maxRequestTimeoutMs,
    ),
    edrPollingAttempts: parseInteger(
      rawProxy.edrPollingAttempts ?? env.CX_EDC_EDR_POLLING_ATTEMPTS,
      defaultEdrPollingAttempts,
      1,
      maxEdrPollingAttempts,
    ),
    edrPollingIntervalMs: parseInteger(
      rawProxy.edrPollingIntervalMs ?? env.CX_EDC_EDR_POLLING_INTERVAL_MS,
      defaultEdrPollingIntervalMs,
      250,
      maxEdrPollingIntervalMs,
    ),
  }
}

/**
 * OAuth2 client credentials mode is selected as soon as one token server setting is present;
 * otherwise the proxy stays in API key mode.
 */
function resolveManagementAuthConfig (
  proxyId: string,
  rawProxy: RawProxyConfig,
  env: Env,
): EdcManagementAuthConfig {
  const apiKey = trimToUndefined(rawProxy.apiKey)
  const tokenServerEndpoint = trimToUndefined(rawProxy.tokenServerEndpoint)
  const clientId = trimToUndefined(rawProxy.tokenServerClientId)
  const clientSecret = trimToUndefined(rawProxy.tokenServerClientSecret)
  const tokenServerSettings = [
    { key: 'tokenServerEndpoint', envName: 'CX_EDC_TOKEN_SERVER_ENDPOINT', value: tokenServerEndpoint },
    { key: 'tokenServerClientId', envName: 'CX_EDC_TOKEN_SERVER_CLIENT_ID', value: clientId },
    { key: 'tokenServerClientSecret', envName: 'CX_EDC_TOKEN_SERVER_CLIENT_SECRET', value: clientSecret },
  ]
  const presentSettings = tokenServerSettings.filter(setting => setting.value)
  const missingSettings = tokenServerSettings.filter(setting => !setting.value)
  const describeSettings = (settings: typeof tokenServerSettings) =>
    settings.map(setting => `${setting.key} (${setting.envName})`).join(', ')

  if (presentSettings.length === 0) {
    return {
      mode: 'api-key',
      apiKey: apiKey ?? '',
      apiKeyHeader: trimToUndefined(rawProxy.apiKeyHeader) ?? defaultApiKeyHeader,
    }
  }

  // Checked before completeness so an API key deployment with a stray token variable is reported as ambiguous.
  if (apiKey) {
    throw new Error(
      `EDC proxy "${proxyId}" configures both API key and OAuth2 client credentials authentication `
      + `(token server settings found: ${describeSettings(presentSettings)}). `
      + 'Remove either the API key settings or the token server settings.',
    )
  }

  if (missingSettings.length > 0) {
    throw new Error(
      `EDC proxy "${proxyId}" uses OAuth2 client credentials authentication but is missing `
      + describeSettings(missingSettings),
    )
  }

  assertTokenServerEndpointAllowed(
    proxyId,
    tokenServerEndpoint ?? '',
    parseBoolean(rawProxy.allowInsecureTokenServerEndpoint)
    || parseBoolean(env.CX_EDC_ALLOW_INSECURE_TOKEN_SERVER_ENDPOINT),
  )

  return {
    mode: 'oauth2-client-credentials',
    tokenServerEndpoint: tokenServerEndpoint ?? '',
    clientId: clientId ?? '',
    clientSecret: clientSecret ?? '',
  }
}

/** The client secret is sent to this endpoint, so plain http needs an explicit opt-in. */
function assertTokenServerEndpointAllowed (proxyId: string, endpoint: string, allowInsecure: boolean): void {
  const endpointUrl = normalizeUrl(endpoint)
  if (!endpointUrl || (endpointUrl.protocol !== 'https:' && endpointUrl.protocol !== 'http:')) {
    throw new Error(
      `EDC proxy "${proxyId}" tokenServerEndpoint (CX_EDC_TOKEN_SERVER_ENDPOINT) must be an absolute http(s) URL`,
    )
  }

  if (endpointUrl.protocol === 'http:' && !allowInsecure) {
    throw new Error(
      `EDC proxy "${proxyId}" tokenServerEndpoint (CX_EDC_TOKEN_SERVER_ENDPOINT) must use https. `
      + 'Set allowInsecureTokenServerEndpoint (CX_EDC_ALLOW_INSECURE_TOKEN_SERVER_ENDPOINT) to true '
      + 'to allow http for local testing.',
    )
  }
}

function normalizeAuthMode (value: unknown): EdcBffAuthMode {
  const mode = String(value ?? 'jwt').trim().toLowerCase()
  if (mode === 'none' || mode === 'jwt') {
    return mode
  }
  throw new Error('CX_EDC_BFF_AUTH_MODE must be "jwt" or "none"')
}

function normalizeUrl (value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

function matchesAllowedAddress (address: URL, allowedAddress: URL): boolean {
  if (address.origin !== allowedAddress.origin) {
    return false
  }

  const allowedPath = allowedAddress.pathname.replace(/\/+$/, '')
  const addressPath = address.pathname.replace(/\/+$/, '')
  return addressPath === allowedPath || addressPath.startsWith(`${allowedPath}/`)
}

function parseInteger (value: unknown, fallback: number, min: number, max: number): number {
  const normalizedValue = typeof value === 'string' ? value.trim() : value
  if (unsetIntegerValues.has(normalizedValue)) {
    return fallback
  }

  const parsed = Number(normalizedValue)
  if (!Number.isInteger(parsed)) {
    return fallback
  }
  return Math.min(max, Math.max(min, parsed))
}

function parseBoolean (value: unknown): boolean {
  return String(value ?? '').trim().toLowerCase() === 'true'
}

function splitCsv (value: unknown): string[] {
  return normalizeStringList(String(value ?? '').split(','))
}

function normalizeStringList (value: unknown): string[] {
  if (typeof value === 'string') {
    return value.split(',').map(item => item.trim()).filter(item => item !== '')
  }

  if (!Array.isArray(value)) {
    return []
  }

  return value.map(item => String(item).trim()).filter(item => item !== '')
}

function uniqueValues (values: string[]): string[] {
  return Array.from(new Set(values))
}

function trimToUndefined (value: unknown): string | undefined {
  const trimmed = String(value ?? '').trim()
  return trimmed === '' ? undefined : trimmed
}
