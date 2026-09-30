import { describe, expect, it } from 'vitest'
import {
  isCounterPartyAddressAllowed,
  loadAuthConfig,
  loadProxyConfigMap,
  redactProxyConfig,
} from '../../../server/edc-bff/config'

describe('EDC BFF config', () => {
  it('loads shorthand default proxy config and redacts secrets', () => {
    const proxies = loadProxyConfigMap({
      CX_EDC_DEFAULT_MANAGEMENT_URL: 'https://consumer-edc.test/management',
      CX_EDC_DEFAULT_API_KEY: 'TEST_API_KEY',
      CX_EDC_DEFAULT_PARTICIPANT_ID: 'TEST_PARTICIPANT_ID',
      CX_EDC_ALLOWED_COUNTER_PARTY_ADDRESSES: 'https://counterparty-dsp.test/api/v1/dsp',
    })

    const proxy = proxies.get('default')
    const redacted = redactProxyConfig(proxy, 'default')

    expect(proxy?.auth).toEqual({
      mode: 'api-key',
      apiKey: 'TEST_API_KEY',
      apiKeyHeader: 'X-Api-Key',
    })
    expect(redacted).toMatchObject({
      id: 'default',
      configured: true,
      managementUrlConfigured: true,
      authMode: 'api-key',
      authConfigured: true,
      apiKeyConfigured: true,
      participantId: 'TEST_PARTICIPANT_ID',
      allowedCounterPartyAddressCount: 1,
    })
    expect(JSON.stringify(redacted)).not.toContain('TEST_API_KEY')
    expect(JSON.stringify(redacted)).not.toContain('consumer-edc.test')
  })

  it('loads EDR polling settings from environment variables', () => {
    const proxies = loadProxyConfigMap({
      CX_EDC_DEFAULT_MANAGEMENT_URL: 'https://consumer-edc.test/management',
      CX_EDC_DEFAULT_API_KEY: 'TEST_API_KEY',
      CX_EDC_ALLOWED_COUNTER_PARTY_ADDRESSES: 'https://counterparty-dsp.test/api/v1/dsp',
      CX_EDC_EDR_POLLING_ATTEMPTS: '45',
      CX_EDC_EDR_POLLING_INTERVAL_MS: '1500',
    })

    expect(proxies.get('default')).toMatchObject({
      edrPollingAttempts: 45,
      edrPollingIntervalMs: 1500,
    })
  })

  it('falls back to default numeric settings for blank environment variables', () => {
    const proxies = loadProxyConfigMap({
      CX_EDC_DEFAULT_MANAGEMENT_URL: 'https://consumer-edc.test/management',
      CX_EDC_DEFAULT_API_KEY: 'TEST_API_KEY',
      CX_EDC_ALLOWED_COUNTER_PARTY_ADDRESSES: 'https://counterparty-dsp.test/api/v1/dsp',
      CX_EDC_REQUEST_TIMEOUT_MS: '',
      CX_EDC_EDR_POLLING_ATTEMPTS: '',
      CX_EDC_EDR_POLLING_INTERVAL_MS: '',
    })

    expect(proxies.get('default')).toMatchObject({
      requestTimeoutMs: 30_000,
      edrPollingAttempts: 30,
      edrPollingIntervalMs: 2000,
    })
  })

  it('loads multiple proxy configs from inline JSON', () => {
    const proxies = loadProxyConfigMap({
      CX_EDC_PROXY_CONFIG_JSON: JSON.stringify({
        proxies: {
          partnerA: {
            managementUrl: 'https://consumer-a.test/management',
            apiKey: 'TEST_API_KEY_A',
            allowedCounterPartyAddresses: ['https://counterparty-a.test/dsp'],
          },
          partnerB: {
            managementUrl: 'https://consumer-b.test/management',
            apiKey: 'TEST_API_KEY_B',
          },
        },
      }),
    })

    expect(proxies.get('partnerA')?.managementUrl).toBe('https://consumer-a.test/management')
    expect(proxies.get('partnerB')?.auth).toMatchObject({ mode: 'api-key', apiKeyHeader: 'X-Api-Key' })
  })

  it('selects the authentication mode per proxy in multi-proxy JSON', () => {
    const proxies = loadProxyConfigMap({
      CX_EDC_PROXY_CONFIG_JSON: JSON.stringify({
        proxies: {
          partnerA: {
            managementUrl: 'https://consumer-a.test/management',
            apiKey: 'TEST_API_KEY_A',
          },
          partnerB: {
            managementUrl: 'https://consumer-b.test/management',
            tokenServerEndpoint: 'https://identity.test/token',
            tokenServerClientId: 'TEST_CLIENT_ID',
            tokenServerClientSecret: 'TEST_CLIENT_SECRET',
          },
        },
      }),
    })

    expect(proxies.get('partnerA')?.auth).toMatchObject({ mode: 'api-key', apiKey: 'TEST_API_KEY_A' })
    expect(proxies.get('partnerB')?.auth).toEqual({
      mode: 'oauth2-client-credentials',
      tokenServerEndpoint: 'https://identity.test/token',
      clientId: 'TEST_CLIENT_ID',
      clientSecret: 'TEST_CLIENT_SECRET',
    })

    expect(() => loadProxyConfigMap({
      CX_EDC_PROXY_CONFIG_JSON: JSON.stringify({
        proxies: {
          partnerB: {
            managementUrl: 'https://consumer-b.test/management',
            tokenServerEndpoint: 'https://identity.test/token',
          },
        },
      }),
    })).toThrow('EDC proxy "partnerB" uses OAuth2 client credentials authentication but is missing tokenServerClientId')
  })

  it('selects OAuth2 client credentials mode when all token server settings are present', () => {
    const proxies = loadProxyConfigMap({
      CX_EDC_DEFAULT_MANAGEMENT_URL: 'https://consumer-edc.test/management',
      CX_EDC_TOKEN_SERVER_ENDPOINT: 'https://identity.test/token',
      CX_EDC_TOKEN_SERVER_CLIENT_ID: 'TEST_CLIENT_ID',
      CX_EDC_TOKEN_SERVER_CLIENT_SECRET: 'TEST_CLIENT_SECRET',
    })

    const redacted = redactProxyConfig(proxies.get('default'), 'default')

    expect(proxies.get('default')?.auth).toEqual({
      mode: 'oauth2-client-credentials',
      tokenServerEndpoint: 'https://identity.test/token',
      clientId: 'TEST_CLIENT_ID',
      clientSecret: 'TEST_CLIENT_SECRET',
    })
    expect(redacted).toMatchObject({
      configured: true,
      authMode: 'oauth2-client-credentials',
      authConfigured: true,
      apiKeyConfigured: false,
    })
    expect(JSON.stringify(redacted)).not.toContain('TEST_CLIENT_SECRET')
  })

  it('fails fast on incomplete or ambiguous EDC authentication configuration', () => {
    expect(() => loadProxyConfigMap({
      CX_EDC_DEFAULT_MANAGEMENT_URL: 'https://consumer-edc.test/management',
      CX_EDC_DEFAULT_API_KEY_HEADER: 'X-Api-Key',
    })).toThrow('EDC proxy "default" has a management URL but no EDC authentication')

    expect(() => loadProxyConfigMap({
      CX_EDC_PROXY_CONFIG_JSON: JSON.stringify({
        proxies: { partnerA: { managementUrl: 'https://consumer-a.test/management' } },
      }),
    })).toThrow('EDC proxy "partnerA" has a management URL but no EDC authentication')

    expect(loadProxyConfigMap({ CX_EDC_DEFAULT_API_KEY: 'TEST_API_KEY' }).get('default')?.managementUrl).toBe('')

    expect(() => loadProxyConfigMap({
      CX_EDC_DEFAULT_MANAGEMENT_URL: 'https://consumer-edc.test/management',
      CX_EDC_TOKEN_SERVER_ENDPOINT: 'https://identity.test/token',
      CX_EDC_TOKEN_SERVER_CLIENT_ID: 'TEST_CLIENT_ID',
    })).toThrow('tokenServerClientSecret (CX_EDC_TOKEN_SERVER_CLIENT_SECRET)')

    expect(() => loadProxyConfigMap({
      CX_EDC_DEFAULT_MANAGEMENT_URL: 'https://consumer-edc.test/management',
      CX_EDC_DEFAULT_API_KEY: 'TEST_API_KEY',
      CX_EDC_TOKEN_SERVER_ENDPOINT: 'https://identity.test/token',
      CX_EDC_TOKEN_SERVER_CLIENT_ID: 'TEST_CLIENT_ID',
      CX_EDC_TOKEN_SERVER_CLIENT_SECRET: 'TEST_CLIENT_SECRET',
    })).toThrow('configures both API key and OAuth2 client credentials authentication')

    expect(() => loadProxyConfigMap({
      CX_EDC_DEFAULT_MANAGEMENT_URL: 'https://consumer-edc.test/management',
      CX_EDC_DEFAULT_API_KEY: 'TEST_API_KEY',
      CX_EDC_TOKEN_SERVER_ENDPOINT: 'https://identity.test/token',
    })).toThrow(
      'configures both API key and OAuth2 client credentials authentication '
      + '(token server settings found: tokenServerEndpoint (CX_EDC_TOKEN_SERVER_ENDPOINT))',
    )
  })

  it('requires a valid https token server endpoint unless insecure endpoints are allowed', () => {
    const oauthEnv = (tokenServerEndpoint: string) => ({
      CX_EDC_DEFAULT_MANAGEMENT_URL: 'https://consumer-edc.test/management',
      CX_EDC_TOKEN_SERVER_ENDPOINT: tokenServerEndpoint,
      CX_EDC_TOKEN_SERVER_CLIENT_ID: 'TEST_CLIENT_ID',
      CX_EDC_TOKEN_SERVER_CLIENT_SECRET: 'TEST_CLIENT_SECRET',
    })

    expect(() => loadProxyConfigMap(oauthEnv('identity.test/token')))
      .toThrow('tokenServerEndpoint (CX_EDC_TOKEN_SERVER_ENDPOINT) must be an absolute http(s) URL')
    expect(() => loadProxyConfigMap(oauthEnv('ftp://identity.test/token')))
      .toThrow('must be an absolute http(s) URL')
    expect(() => loadProxyConfigMap(oauthEnv('http://localhost:8183/token')))
      .toThrow('tokenServerEndpoint (CX_EDC_TOKEN_SERVER_ENDPOINT) must use https')

    const proxies = loadProxyConfigMap({
      ...oauthEnv('http://localhost:8183/token'),
      CX_EDC_ALLOW_INSECURE_TOKEN_SERVER_ENDPOINT: 'true',
    })
    expect(proxies.get('default')?.auth).toMatchObject({ tokenServerEndpoint: 'http://localhost:8183/token' })

    const jsonProxies = loadProxyConfigMap({
      CX_EDC_PROXY_CONFIG_JSON: JSON.stringify({
        proxies: {
          local: {
            managementUrl: 'http://localhost:8182/management',
            tokenServerEndpoint: 'http://localhost:8183/token',
            tokenServerClientId: 'TEST_CLIENT_ID',
            tokenServerClientSecret: 'TEST_CLIENT_SECRET',
            allowInsecureTokenServerEndpoint: true,
          },
        },
      }),
    })
    expect(jsonProxies.get('local')?.auth).toMatchObject({ tokenServerEndpoint: 'http://localhost:8183/token' })
  })

  it('requires JWKS configuration for JWT auth mode', () => {
    expect(() => loadAuthConfig({ CX_EDC_BFF_AUTH_MODE: 'jwt' })).toThrow(
      'CX_EDC_BFF_AUTH_JWKS_URL is required',
    )
    expect(loadAuthConfig({ CX_EDC_BFF_AUTH_MODE: 'none' }).mode).toBe('none')
    expect(() => loadAuthConfig({ CX_EDC_BFF_AUTH_MODE: 'basic' })).toThrow(
      'CX_EDC_BFF_AUTH_MODE must be "jwt" or "none"',
    )
  })

  it('allows only configured counterparty address prefixes', () => {
    const insecureProviderAddress = 'http' + '://counterparty-dsp.test/api/v1/dsp'
    const proxy = loadProxyConfigMap({
      CX_EDC_DEFAULT_MANAGEMENT_URL: 'https://consumer-edc.test/management',
      CX_EDC_DEFAULT_API_KEY: 'TEST_API_KEY',
      CX_EDC_ALLOWED_COUNTER_PARTY_ADDRESSES: 'https://counterparty-dsp.test/api/v1/dsp',
    }).get('default')!

    expect(isCounterPartyAddressAllowed(proxy, 'https://counterparty-dsp.test/api/v1/dsp')).toBe(true)
    expect(isCounterPartyAddressAllowed(proxy, 'https://counterparty-dsp.test/api/v1/dsp/2025-1')).toBe(true)
    expect(isCounterPartyAddressAllowed(proxy, 'https://blocked-counterparty.test/api/v1/dsp')).toBe(false)
    expect(isCounterPartyAddressAllowed(proxy, insecureProviderAddress)).toBe(false)
  })

  it('requires an explicit wildcard to allow arbitrary HTTPS counterparties', () => {
    const insecureProviderAddress = 'http' + '://counterparty-dsp.test/api/v1/dsp'
    const proxy = loadProxyConfigMap({
      CX_EDC_DEFAULT_MANAGEMENT_URL: 'https://consumer-edc.test/management',
      CX_EDC_DEFAULT_API_KEY: 'TEST_API_KEY',
      CX_EDC_ALLOWED_COUNTER_PARTY_ADDRESSES: '*',
    }).get('default')!

    expect(isCounterPartyAddressAllowed(proxy, 'https://counterparty-dsp.test/api/v1/dsp')).toBe(true)
    expect(isCounterPartyAddressAllowed(proxy, insecureProviderAddress)).toBe(false)
  })
})
