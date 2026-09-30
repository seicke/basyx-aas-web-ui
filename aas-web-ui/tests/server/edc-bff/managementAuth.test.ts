import type { EdcProxyConfig } from '../../../server/edc-bff/types'
import { describe, expect, it, vi } from 'vitest'
import { createManagementAuthProvider, getManagementAuthProvider } from '../../../server/edc-bff/managementAuth'

function createTokenResponse (body: unknown, status = 200): Response {
  return Response.json(body, { status })
}

function createTokenFetch (accessToken: string) {
  return vi.fn(async () => createTokenResponse({ access_token: accessToken, expires_in: 300 }))
}

describe('EDC management authentication', () => {
  it('sends the configured API key header', async () => {
    const provider = createManagementAuthProvider({
      mode: 'api-key',
      apiKey: 'TEST_API_KEY',
      apiKeyHeader: 'X-Custom-Key',
    })

    expect(provider.mode).toBe('api-key')
    await expect(provider.getAuthHeaders()).resolves.toEqual({ 'X-Custom-Key': 'TEST_API_KEY' })
  })

  it('requests an access token with basic client credentials and caches it', async () => {
    const fetchFn = vi.fn(async () => createTokenResponse({ access_token: 'TEST_ACCESS_TOKEN', expires_in: 300 }))
    const provider = createManagementAuthProvider(
      {
        mode: 'oauth2-client-credentials',
        tokenServerEndpoint: 'https://identity.test/token',
        clientId: 'TEST_CLIENT_ID',
        clientSecret: 'TEST_CLIENT_SECRET',
      },
      { fetchFn: fetchFn as unknown as typeof fetch, now: () => 0 },
    )

    const [first, second] = await Promise.all([provider.getAuthHeaders(), provider.getAuthHeaders()])
    const third = await provider.getAuthHeaders()

    expect(first).toEqual({ Authorization: 'TEST_ACCESS_TOKEN' })
    expect(second).toEqual(first)
    expect(third).toEqual(first)
    expect(fetchFn).toHaveBeenCalledTimes(1)

    const [endpoint, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    const expectedCredentials = Buffer.from('TEST_CLIENT_ID:TEST_CLIENT_SECRET').toString('base64')

    expect(endpoint).toBe('https://identity.test/token')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${expectedCredentials}`)
    expect(String(init.body)).toBe('grant_type=client_credentials')
  })

  it('caches providers per proxy and fetch implementation', async () => {
    const proxy: EdcProxyConfig = {
      id: 'default',
      managementUrl: 'https://consumer-edc.test/management',
      auth: {
        mode: 'oauth2-client-credentials',
        tokenServerEndpoint: 'https://identity.test/token',
        clientId: 'TEST_CLIENT_ID',
        clientSecret: 'TEST_CLIENT_SECRET',
      },
      allowedCounterPartyAddresses: [],
      allowInsecureCounterPartyAddresses: false,
      requestTimeoutMs: 30_000,
      edrPollingAttempts: 30,
      edrPollingIntervalMs: 2000,
    }
    const firstFetch = createTokenFetch('FIRST_ACCESS_TOKEN')
    const secondFetch = createTokenFetch('SECOND_ACCESS_TOKEN')
    const firstProvider = getManagementAuthProvider(proxy, firstFetch as unknown as typeof fetch)
    const secondProvider = getManagementAuthProvider(proxy, secondFetch as unknown as typeof fetch)

    expect(getManagementAuthProvider(proxy, firstFetch as unknown as typeof fetch)).toBe(firstProvider)
    await expect(firstProvider.getAuthHeaders()).resolves.toEqual({ Authorization: 'FIRST_ACCESS_TOKEN' })
    await expect(secondProvider.getAuthHeaders()).resolves.toEqual({ Authorization: 'SECOND_ACCESS_TOKEN' })
    await firstProvider.getAuthHeaders()

    expect(firstFetch).toHaveBeenCalledTimes(1)
    expect(secondFetch).toHaveBeenCalledTimes(1)
  })

  it('refreshes the access token before it expires', async () => {
    const fetchFn = vi.fn(async () => createTokenResponse({ access_token: 'TEST_ACCESS_TOKEN', expires_in: 60 }))
    let currentTime = 0
    const provider = createManagementAuthProvider(
      {
        mode: 'oauth2-client-credentials',
        tokenServerEndpoint: 'https://identity.test/token',
        clientId: 'TEST_CLIENT_ID',
        clientSecret: 'TEST_CLIENT_SECRET',
      },
      { fetchFn: fetchFn as unknown as typeof fetch, now: () => currentTime },
    )

    await provider.getAuthHeaders()
    currentTime = 29_000
    await provider.getAuthHeaders()
    currentTime = 31_000
    await provider.getAuthHeaders()

    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('reports specific token endpoint failures', async () => {
    async function expectTokenError (response: Response | Error, message: string): Promise<void> {
      const provider = createManagementAuthProvider(
        {
          mode: 'oauth2-client-credentials',
          tokenServerEndpoint: 'https://identity.test/token',
          clientId: 'TEST_CLIENT_ID',
          clientSecret: 'TEST_CLIENT_SECRET',
        },
        {
          fetchFn: (async () => {
            if (response instanceof Error) {
              throw response
            }
            return response
          }) as unknown as typeof fetch,
        },
      )

      await expect(provider.getAuthHeaders()).rejects.toThrow(message)
    }

    await expectTokenError(
      createTokenResponse({ error: 'invalid_client' }, 401),
      'rejected the configured client credentials with HTTP 401',
    )
    await expectTokenError(
      createTokenResponse({ error: 'server_error' }, 500),
      'EDC OAuth2 token endpoint responded with HTTP 500',
    )
    await expectTokenError(
      new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
      'returned a body that is not valid JSON',
    )
    await expectTokenError(
      createTokenResponse({ token_type: 'Bearer' }),
      'did not contain an access_token',
    )
    await expectTokenError(
      new TypeError('fetch failed'),
      'EDC OAuth2 token request failed: fetch failed',
    )
  })
})
