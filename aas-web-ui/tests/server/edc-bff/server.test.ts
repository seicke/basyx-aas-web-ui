import type { EdcBffRuntimeConfig, EdcProxyConfig } from '../../../server/edc-bff/types'
import type { IncomingHttpHeaders, Server } from 'node:http'
import { createServer as createHttpServer } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { createEdcBffServer } from '../../../server/edc-bff/server'

let server: Server | null = null
let upstreamServer: Server | null = null

describe('EDC BFF server', () => {
  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close(error => error ? reject(error) : resolve())
      })
      server = null
    }
    if (upstreamServer) {
      await new Promise<void>((resolve, reject) => {
        upstreamServer?.close(error => error ? reject(error) : resolve())
      })
      upstreamServer = null
    }
  })

  it('returns redacted status for configured proxies and 404 for unknown proxies', async () => {
    const config: EdcBffRuntimeConfig = {
      port: 0,
      auth: { mode: 'none', requiredRoles: [] },
      proxies: new Map([
        ['default', {
          id: 'default',
          managementUrl: 'https://consumer-edc.test/management',
          auth: { mode: 'api-key', apiKey: 'TEST_API_KEY', apiKeyHeader: 'X-Api-Key' },
          allowedCounterPartyAddresses: [],
          allowInsecureCounterPartyAddresses: false,
          requestTimeoutMs: 30_000,
          edrPollingAttempts: 30,
          edrPollingIntervalMs: 2000,
        }],
      ]),
    }

    server = createEdcBffServer(config)
    await new Promise<void>(resolve => server?.listen(0, resolve))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0

    const statusResponse = await fetch(`http://127.0.0.1:${port}/api/catena-x/edc/default/status`)
    const statusPayload = await statusResponse.json()

    expect(statusResponse.status).toBe(200)
    expect(statusPayload).toMatchObject({
      id: 'default',
      configured: true,
      managementUrlConfigured: true,
      apiKeyConfigured: true,
    })
    expect(JSON.stringify(statusPayload)).not.toContain('TEST_API_KEY')
    expect(JSON.stringify(statusPayload)).not.toContain('consumer-edc.test')

    const missingResponse = await fetch(`http://127.0.0.1:${port}/api/catena-x/edc/missing/status`)

    expect(missingResponse.status).toBe(404)
  })

  it('returns route diagnostics for unsupported BFF actions without exposing secrets', async () => {
    const config: EdcBffRuntimeConfig = {
      port: 0,
      auth: { mode: 'none', requiredRoles: [] },
      proxies: new Map([
        ['default', {
          id: 'default',
          managementUrl: 'https://consumer-edc.test/management',
          auth: { mode: 'api-key', apiKey: 'TEST_API_KEY', apiKeyHeader: 'X-Api-Key' },
          allowedCounterPartyAddresses: [],
          allowInsecureCounterPartyAddresses: false,
          requestTimeoutMs: 30_000,
          edrPollingAttempts: 30,
          edrPollingIntervalMs: 2000,
        }],
      ]),
    }

    server = createEdcBffServer(config)
    await new Promise<void>(resolve => server?.listen(0, resolve))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0

    const response = await fetch(`http://127.0.0.1:${port}/api/catena-x/edc/default/unknown/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    const payload = await response.json()

    expect(response.status).toBe(404)
    expect(payload).toMatchObject({
      error: 'Route not found',
      status: 404,
      code: 'ROUTE_NOT_FOUND',
      method: 'POST',
      path: '/api/catena-x/edc/default/unknown/action',
    })
    expect(JSON.stringify(payload)).not.toContain('TEST_API_KEY')
    expect(JSON.stringify(payload)).not.toContain('consumer-edc.test')
  })

  it('serves DTR descriptor pages through the EDC flow without exposing secrets', async () => {
    upstreamServer = createHttpServer((request, response) => {
      response.setHeader('Content-Type', 'application/json')

      if (request.url === '/management/v3/catalog/request') {
        response.end(JSON.stringify({
          'dspace:participantId': 'TEST_PARTICIPANT_ID',
          'dcat:dataset': {
            '@id': 'dtr-asset',
            'dct:type': { '@id': 'https://w3id.org/catenax/taxonomy#DigitalTwinRegistry' },
            'odrl:hasPolicy': {
              '@id': 'offer-1',
              '@type': 'odrl:Offer',
              'odrl:permission': [],
            },
          },
        }))
        return
      }

      if (request.url === '/management/v3/edrs') {
        response.end(JSON.stringify({ '@id': 'negotiation-1' }))
        return
      }

      if (request.url === '/management/v3/edrs/request') {
        response.end(JSON.stringify([{
          transferProcessId: 'transfer-1',
          assetId: 'dtr-asset',
          providerId: 'TEST_PARTICIPANT_ID',
          agreementId: 'agreement-1',
        }]))
        return
      }

      if (request.url === '/management/v3/edrs/transfer-1/dataaddress?auto_refresh=true') {
        const address = upstreamServer?.address()
        const port = typeof address === 'object' && address ? address.port : 0
        response.end(JSON.stringify({
          endpoint: `http://127.0.0.1:${port}/data`,
          authorization: 'TEST_EDR_AUTHORIZATION',
        }))
        return
      }

      if (request.url === '/data/shell-descriptors?limit=10') {
        expect(request.headers.authorization).toBe('TEST_EDR_AUTHORIZATION')
        response.end(JSON.stringify({ result: [{ id: 'aas-1' }] }))
        return
      }

      response.statusCode = 404
      response.end(JSON.stringify({ error: 'not found' }))
    })
    await new Promise<void>(resolve => upstreamServer?.listen(0, resolve))
    const upstreamAddress = upstreamServer.address()
    const upstreamPort = typeof upstreamAddress === 'object' && upstreamAddress ? upstreamAddress.port : 0

    const config: EdcBffRuntimeConfig = {
      port: 0,
      auth: { mode: 'none', requiredRoles: [] },
      proxies: new Map([
        ['default', {
          id: 'default',
          managementUrl: `http://127.0.0.1:${upstreamPort}/management`,
          auth: { mode: 'api-key', apiKey: 'TEST_API_KEY', apiKeyHeader: 'X-Api-Key' },
          allowedCounterPartyAddresses: ['https://counterparty-dsp.test/api/v1/dsp'],
          allowInsecureCounterPartyAddresses: false,
          requestTimeoutMs: 30_000,
          edrPollingAttempts: 30,
          edrPollingIntervalMs: 2000,
        }],
      ]),
    }

    server = createEdcBffServer(config)
    await new Promise<void>(resolve => server?.listen(0, resolve))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0

    const response = await fetch(`http://127.0.0.1:${port}/api/catena-x/edc/default/dtr/shell-descriptors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        counterPartyId: 'TEST_PARTICIPANT_ID',
        counterPartyAddress: 'https://counterparty-dsp.test/api/v1/dsp',
        protocol: 'dataspace-protocol-http',
        limit: 10,
      }),
    })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      data: { result: [{ id: 'aas-1' }] },
      edc: {
        transferProcessId: 'transfer-1',
        assetId: 'dtr-asset',
        providerId: 'TEST_PARTICIPANT_ID',
        agreementId: 'agreement-1',
        contractNegotiationId: 'negotiation-1',
      },
    })
    expect(JSON.stringify(payload)).not.toContain('TEST_API_KEY')
    expect(JSON.stringify(payload)).not.toContain('TEST_EDR_AUTHORIZATION')
  })

  it('serves Submodels through the EDC flow without exposing secrets', async () => {
    upstreamServer = createHttpServer((request, response) => {
      response.setHeader('Content-Type', 'application/json')

      if (request.url === '/management/v3/catalog/request') {
        response.end(JSON.stringify({
          'dspace:participantId': 'TEST_PARTICIPANT_ID',
          'dcat:dataset': {
            '@id': 'submodel-asset',
            'odrl:hasPolicy': {
              '@id': 'offer-submodel',
              '@type': 'odrl:Offer',
              'odrl:permission': [],
            },
          },
        }))
        return
      }

      if (request.url === '/management/v3/edrs') {
        response.end(JSON.stringify({ '@id': 'submodel-negotiation-1' }))
        return
      }

      if (request.url === '/management/v3/edrs/request') {
        response.end(JSON.stringify([{
          transferProcessId: 'submodel-transfer-1',
          assetId: 'submodel-asset',
          providerId: 'TEST_PARTICIPANT_ID',
          agreementId: 'submodel-agreement-1',
        }]))
        return
      }

      if (request.url === '/management/v3/edrs/submodel-transfer-1/dataaddress?auto_refresh=true') {
        const address = upstreamServer?.address()
        const port = typeof address === 'object' && address ? address.port : 0
        response.end(JSON.stringify({
          endpoint: `http://127.0.0.1:${port}/api/public`,
          authorization: 'TEST_SUBMODEL_AUTHORIZATION',
        }))
        return
      }

      if (request.url === '/api/public/submodel/data') {
        expect(request.headers.authorization).toBe('TEST_SUBMODEL_AUTHORIZATION')
        response.end(JSON.stringify({
          id: 'urn:example:submodel:1',
          submodelElements: [{ modelType: 'Property', idShort: 'temperature', value: '20' }],
        }))
        return
      }

      response.statusCode = 404
      response.end(JSON.stringify({ error: 'not found' }))
    })
    await new Promise<void>(resolve => upstreamServer?.listen(0, resolve))
    const upstreamAddress = upstreamServer.address()
    const upstreamPort = typeof upstreamAddress === 'object' && upstreamAddress ? upstreamAddress.port : 0

    const config: EdcBffRuntimeConfig = {
      port: 0,
      auth: { mode: 'none', requiredRoles: [] },
      proxies: new Map([
        ['default', {
          id: 'default',
          managementUrl: `http://127.0.0.1:${upstreamPort}/management`,
          auth: { mode: 'api-key', apiKey: 'TEST_API_KEY', apiKeyHeader: 'X-Api-Key' },
          allowedCounterPartyAddresses: ['https://counterparty-dsp.test/api/v1/dsp'],
          allowInsecureCounterPartyAddresses: false,
          requestTimeoutMs: 30_000,
          edrPollingAttempts: 30,
          edrPollingIntervalMs: 2000,
        }],
      ]),
    }

    server = createEdcBffServer(config)
    await new Promise<void>(resolve => server?.listen(0, resolve))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    const response = await fetch(`http://127.0.0.1:${port}/api/catena-x/edc/default/submodels/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        counterPartyId: 'TEST_PARTICIPANT_ID',
        counterPartyAddress: 'https://counterparty-dsp.test/api/v1/dsp',
        protocol: 'dataspace-protocol-http',
        submodelDescriptor: {
          endpoints: [{
            protocolInformation: {
              href: `http://old-data-plane.test:${upstreamPort}/api/public/submodel/data`,
              subprotocol: 'DSP',
              subprotocolBody: 'id=submodel-asset;dspEndpoint=https://counterparty-dsp.test/api/v1/dsp',
            },
          }],
        },
      }),
    })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      data: {
        id: 'urn:example:submodel:1',
        submodelElements: [{ idShort: 'temperature' }],
      },
      edc: {
        transferProcessId: 'submodel-transfer-1',
        assetId: 'submodel-asset',
        providerId: 'TEST_PARTICIPANT_ID',
        agreementId: 'submodel-agreement-1',
        contractNegotiationId: 'submodel-negotiation-1',
      },
    })
    expect(JSON.stringify(payload)).not.toContain('TEST_API_KEY')
    expect(JSON.stringify(payload)).not.toContain('TEST_SUBMODEL_AUTHORIZATION')
  })

  it('authenticates EDC calls with an OAuth2 access token without exposing secrets', async () => {
    const validCredentials = `Basic ${Buffer.from('TEST_CLIENT_ID:TEST_CLIENT_SECRET').toString('base64')}`
    const managementHeaders: IncomingHttpHeaders[] = []

    upstreamServer = createHttpServer(async (request, response) => {
      let body = ''
      for await (const chunk of request) {
        body += chunk
      }
      response.setHeader('Content-Type', 'application/json')

      if (request.url === '/token') {
        if (request.headers.authorization !== validCredentials || body !== 'grant_type=client_credentials') {
          response.statusCode = 401
          response.end(JSON.stringify({ error: 'invalid_client' }))
          return
        }
        response.end(JSON.stringify({ access_token: 'TEST_ACCESS_TOKEN', expires_in: 300 }))
        return
      }

      if (request.url === '/management/v4alpha/connectordiscovery/connectors') {
        managementHeaders.push(request.headers)
        response.end(JSON.stringify([{ 'edc:counterPartyId': 'TEST_PARTICIPANT_ID' }]))
        return
      }

      response.statusCode = 404
      response.end(JSON.stringify({ error: 'not found' }))
    })
    await new Promise<void>(resolve => upstreamServer?.listen(0, resolve))
    const upstreamAddress = upstreamServer.address()
    const upstreamPort = typeof upstreamAddress === 'object' && upstreamAddress ? upstreamAddress.port : 0

    const createOAuthProxy = (id: string, clientSecret: string): EdcProxyConfig => ({
      id,
      managementUrl: `http://127.0.0.1:${upstreamPort}/management`,
      auth: {
        mode: 'oauth2-client-credentials',
        tokenServerEndpoint: `http://127.0.0.1:${upstreamPort}/token`,
        clientId: 'TEST_CLIENT_ID',
        clientSecret,
      },
      allowedCounterPartyAddresses: [],
      allowInsecureCounterPartyAddresses: false,
      requestTimeoutMs: 30_000,
      edrPollingAttempts: 30,
      edrPollingIntervalMs: 2000,
    })
    const config: EdcBffRuntimeConfig = {
      port: 0,
      auth: { mode: 'none', requiredRoles: [] },
      proxies: new Map([
        ['default', createOAuthProxy('default', 'TEST_CLIENT_SECRET')],
        ['rejected', createOAuthProxy('rejected', 'WRONG_CLIENT_SECRET')],
      ]),
    }

    server = createEdcBffServer(config)
    await new Promise<void>(resolve => server?.listen(0, resolve))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    const discover = (proxyId: string) => fetch(
      `http://127.0.0.1:${port}/api/catena-x/edc/${proxyId}/connectors/discover`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ counterPartyId: 'TEST_PARTICIPANT_ID' }),
      },
    )

    const statusResponse = await fetch(`http://127.0.0.1:${port}/api/catena-x/edc/default/status`)
    const statusPayload = await statusResponse.json()

    expect(statusPayload).toMatchObject({
      configured: true,
      authMode: 'oauth2-client-credentials',
      authConfigured: true,
      apiKeyConfigured: false,
    })
    expect(JSON.stringify(statusPayload)).not.toContain('TEST_CLIENT_SECRET')

    const response = await discover('default')
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual([{ 'edc:counterPartyId': 'TEST_PARTICIPANT_ID' }])
    expect(managementHeaders).toHaveLength(1)
    expect(managementHeaders[0]?.authorization).toBe('TEST_ACCESS_TOKEN')
    expect(managementHeaders[0]?.['x-api-key']).toBeUndefined()

    const rejectedResponse = await discover('rejected')
    const rejectedPayload = await rejectedResponse.json()

    expect(rejectedResponse.status).toBe(502)
    expect(rejectedPayload).toMatchObject({
      error: 'EDC OAuth2 token endpoint rejected the configured client credentials with HTTP 401',
      status: 502,
    })
    expect(managementHeaders).toHaveLength(1)
    expect(JSON.stringify([payload, rejectedPayload])).not.toMatch(/TEST_ACCESS_TOKEN|CLIENT_SECRET/)
  })
})
