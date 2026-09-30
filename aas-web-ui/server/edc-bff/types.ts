export type EdcBffAuthMode = 'jwt' | 'none'

export type EdcManagementAuthMode = 'api-key' | 'oauth2-client-credentials'

export interface EdcApiKeyAuthConfig {
  mode: 'api-key'
  apiKey: string
  apiKeyHeader: string
}

export interface EdcOAuth2ClientCredentialsAuthConfig {
  mode: 'oauth2-client-credentials'
  tokenServerEndpoint: string
  clientId: string
  clientSecret: string
}

export type EdcManagementAuthConfig = EdcApiKeyAuthConfig | EdcOAuth2ClientCredentialsAuthConfig

export interface EdcProxyConfig {
  id: string
  managementUrl: string
  auth: EdcManagementAuthConfig
  participantId?: string
  dspEndpoint?: string
  dataPlaneProxyUrl?: string
  allowedCounterPartyAddresses: string[]
  allowInsecureCounterPartyAddresses: boolean
  requestTimeoutMs: number
  edrPollingAttempts: number
  edrPollingIntervalMs: number
}

export interface RedactedEdcProxyConfig {
  id: string
  configured: boolean
  managementUrlConfigured: boolean
  authMode?: EdcManagementAuthMode
  authConfigured: boolean
  apiKeyConfigured: boolean
  participantId?: string
  dspEndpointConfigured: boolean
  dataPlaneProxyUrlConfigured: boolean
  allowedCounterPartyAddressCount: number
  allowInsecureCounterPartyAddresses: boolean
}

export interface EdcBffAuthConfig {
  mode: EdcBffAuthMode
  issuer?: string
  audience?: string
  jwksUrl?: string
  requiredRoles: string[]
}

export interface EdcBffRuntimeConfig {
  port: number
  auth: EdcBffAuthConfig
  proxies: Map<string, EdcProxyConfig>
}

export interface EdcDiscoveryRequest {
  mode?: 'connectors' | 'dspversionparams'
  counterPartyId?: string
  counterPartyAddress?: string
}

export interface EdcCatalogRequest {
  counterPartyId?: string
  counterPartyAddress?: string
  protocol?: string
  querySpec?: Record<string, unknown>
}

export interface EdcDtrDescriptorRequest {
  counterPartyId?: string
  counterPartyAddress?: string
  protocol?: string
  transferProcessId?: string
  assetIds?: Array<{ name?: string, value?: string }>
  cursor?: string
  limit?: number
}

export interface EdcDtrDescriptorByIdRequest {
  counterPartyId?: string
  counterPartyAddress?: string
  protocol?: string
  transferProcessId?: string
  descriptorId?: string
}

export interface EdcSubmodelFetchRequest {
  counterPartyId?: string
  counterPartyAddress?: string
  protocol?: string
  transferProcessId?: string
  submodelDescriptor?: unknown
  href?: string
  subprotocolBody?: string
}
