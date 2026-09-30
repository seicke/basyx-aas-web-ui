# Catena-X EDC BFF Local Development

This guide explains how to run the Catena-X EDC backend-for-frontend (BFF) locally while using the Vite dev server for the BaSyx AAS Web UI.

The important security rule is: the browser only knows an EDC `proxyId`. The EDC Management API URL and `x-api-key` stay in the local BFF process.

Local BFF development requires Node.js 24 LTS. Native environment proxy support is disabled by default. Enable it explicitly only when outgoing EDC requests must use an `HTTP_PROXY` or `HTTPS_PROXY`.

## 1. Configure a Catena-X Infrastructure

Use a Catena-X infrastructure in `aas-web-ui/public/config/basyx-infra.yml` or configure it in the UI:

```yaml
infrastructures:
  default: local-catena-x

  local-catena-x:
    name: Local Catena-X
    template: catena-x
    components:
      digitalTwinRegistry:
        baseUrl: "http://localhost:5004/api/v3"
      submodelService:
        baseUrl: "http://localhost:5005"
    catenaX:
      edc:
        proxyId: default
        defaultCounterPartyId: "TEST_COUNTERPARTY_ID"
        defaultCounterPartyAddress: "https://counterparty-dsp.test/api/v1/dsp"
    security:
      type: none
```

Only `proxyId` and optional UI defaults belong in this file. Do not add the EDC Management API URL, API key, or OAuth2 client credentials here.

## 2. Choose an EDC Authentication Mode

The BFF authenticates every call to the consumer EDC Management API through one shared component,
`server/edc-bff/managementAuth.ts`. It supports two modes and selects one per EDC proxy purely from configuration.

### Selection rule

1. If none of `CX_EDC_TOKEN_SERVER_ENDPOINT`, `CX_EDC_TOKEN_SERVER_CLIENT_ID`, and
   `CX_EDC_TOKEN_SERVER_CLIENT_SECRET` is set, the proxy uses **API key** mode. When a Management API URL is
   configured, `CX_EDC_DEFAULT_API_KEY` is then required.
2. If at least one of them is set, the proxy uses **OAuth2 client credentials** mode. All three values are then
   required, and `CX_EDC_DEFAULT_API_KEY` must not be set.

The same rule applies to multi-proxy documents, where the per-proxy keys are `apiKey`, `apiKeyHeader`,
`tokenServerEndpoint`, `tokenServerClientId`, and `tokenServerClientSecret`.

Because the client secret is sent to the token endpoint, `CX_EDC_TOKEN_SERVER_ENDPOINT` must be an `https://` URL.
For local testing, `CX_EDC_ALLOW_INSECURE_TOKEN_SERVER_ENDPOINT=true` (per proxy: `allowInsecureTokenServerEndpoint`)
also allows `http://`.

| Mode | Configuration | Outgoing header |
| --- | --- | --- |
| `api-key` | `CX_EDC_DEFAULT_API_KEY`, `CX_EDC_DEFAULT_API_KEY_HEADER` (default `X-Api-Key`) | `<header>: <api key>` |
| `oauth2-client-credentials` | `CX_EDC_TOKEN_SERVER_ENDPOINT`, `CX_EDC_TOKEN_SERVER_CLIENT_ID`, `CX_EDC_TOKEN_SERVER_CLIENT_SECRET` | `Authorization: Bearer <access_token>` |

Deployments that only configure `CX_EDC_DEFAULT_API_KEY*` keep their previous behaviour.

### Implementation design

- `config.ts` normalizes each proxy into a discriminated `EdcProxyConfig.auth` union and validates it while the
  configuration is loaded, so a misconfigured deployment fails at startup instead of on the first EDC request.
- `managementAuth.ts` turns that config into an `EdcManagementAuthProvider` with a single
  `getAuthHeaders()` method. Providers are cached per proxy config object, so one token cache is shared by all
  routes.
- `edcRequests.ts` builds the headers for both `forwardJsonToEdc` and `forwardGetToEdc` from that provider, so
  discovery, catalog, EDR, DTR, and Submodel calls all use the same authentication logic.
- `/status` reports `authMode`, `authConfigured`, and `apiKeyConfigured` only; no secret, URL, or token is
  exposed to the browser, and nothing is logged.

### Token lifecycle in OAuth2 mode

- The token is requested with `POST <token endpoint>`, `Content-Type: application/x-www-form-urlencoded`,
  HTTP basic client authentication, and the body `grant_type=client_credentials`.
- The access token is sent as `Authorization: Bearer <access_token>`, the standard OAuth2 bearer format
  (RFC 6750). A missing `token_type` is treated as `Bearer`; any other `token_type` is rejected.
- The access token is cached in memory and reused until it is close to expiry.
- The cached lifetime is `expires_in` minus a 30 s refresh skew. Tokens that live 60 s or less use half their
  lifetime as skew instead, so every token is refreshed before it expires. Responses without a usable
  `expires_in` fall back to 5 minutes.
- Concurrent EDC calls share a single in-flight token request; the next request after expiry triggers a refresh.
- If the EDC answers `401` although the token is still cached (for example after revocation, key rotation, or
  clock drift), the BFF drops that token, requests a new one, and retries the call once. A second `401` is returned
  to the caller. API key mode never retries, because the key would not change.
- The token request uses the proxy's `CX_EDC_REQUEST_TIMEOUT_MS`.

### Error cases

| Situation | Result |
| --- | --- |
| Incomplete OAuth2 configuration | Startup error naming each missing setting |
| API key and OAuth2 configured together | Startup error about the ambiguous mode |
| Token endpoint is not an absolute `http(s)` URL | Startup error about `tokenServerEndpoint` |
| Token endpoint uses `http://` without the insecure opt-in | Startup error asking for `https` or `CX_EDC_ALLOW_INSECURE_TOKEN_SERVER_ENDPOINT=true` |
| Management API URL set, but neither API key nor OAuth2 configured | Startup error asking for one of the two modes |
| Management API URL missing | `503 EDC proxy is not fully configured` |
| Token endpoint answers `401`/`403` or OAuth2 error `invalid_client` | `502 EDC OAuth2 token endpoint rejected the configured client credentials with HTTP <status> (error: <code>)` |
| Token endpoint answers another error status | `502 EDC OAuth2 token endpoint responded with HTTP <status> (error: <code>)` |
| Token endpoint returns a non-JSON body | `502 EDC OAuth2 token endpoint returned a body that is not valid JSON` |
| Token response has no `access_token` | `502 EDC OAuth2 token endpoint response did not contain an access_token` |
| Token response has a `token_type` other than `Bearer` | `502 EDC OAuth2 token endpoint returned a token that is not a Bearer token (token_type: <type>)` |
| Token request times out | `504 EDC OAuth2 token request timed out after <ms> ms` |
| Token request fails to connect | `502 EDC OAuth2 token request failed: <reason>` |

For error statuses, `(error: <code>)` carries the OAuth2 `error` code from the token server response, for example
`unauthorized_client` or `invalid_scope`, and is omitted when the body has none. The free-text `error_description`
is not passed on. Error messages never include the client secret, the API key, or the access token.

## 3. Run the BFF

From `aas-web-ui`, build the BFF once:

```bash
pnpm bff:build
```

Start it with local development auth disabled:

```bash
CX_EDC_BFF_AUTH_MODE=none \
CX_EDC_DEFAULT_MANAGEMENT_URL=http://localhost:8182/management \
CX_EDC_DEFAULT_API_KEY=<EDC_MANAGEMENT_API_KEY> \
CX_EDC_ALLOWED_COUNTER_PARTY_ADDRESSES='*' \
CX_EDC_ALLOW_INSECURE_COUNTER_PARTY_ADDRESSES=true \
pnpm bff:start
```

To run the same BFF in OAuth2 client credentials mode, replace the API key variable with the token server
variables:

```bash
CX_EDC_BFF_AUTH_MODE=none \
CX_EDC_DEFAULT_MANAGEMENT_URL=http://localhost:8182/management \
CX_EDC_TOKEN_SERVER_ENDPOINT=http://localhost:8183/token \
CX_EDC_TOKEN_SERVER_CLIENT_ID=<EDC_TOKEN_CLIENT_ID> \
CX_EDC_TOKEN_SERVER_CLIENT_SECRET=<EDC_TOKEN_CLIENT_SECRET> \
CX_EDC_ALLOW_INSECURE_TOKEN_SERVER_ENDPOINT=true \
CX_EDC_ALLOWED_COUNTER_PARTY_ADDRESSES='*' \
CX_EDC_ALLOW_INSECURE_COUNTER_PARTY_ADDRESSES=true \
pnpm bff:start
```

In VS Code, use the **Catena-X EDC BFF** launch configuration for API key mode or **Catena-X EDC BFF (OAuth2)** for
OAuth2 mode. Each has a matching **AAS Web UI + …** compound that also starts the UI dev server.

For watch mode, build and run the BFF together with:

```bash
pnpm bff:dev
```

### Opt in to an environment proxy

The normal BFF commands make direct requests, even when `HTTP_PROXY` or `HTTPS_PROXY` exists in the surrounding environment. To opt in, use the corresponding proxy command:

```bash
pnpm bff:start:proxy
# or, for watch mode
pnpm bff:dev:proxy
```

You can also enable Node.js native proxy support for any BFF launch by setting `NODE_USE_ENV_PROXY=1` before it starts. In the VS Code launch configuration, explicitly select **Enabled (use environment proxy)**; it defaults to direct requests.

Container images also keep proxy support disabled by default. Opt in at runtime for either the standalone BFF image or the integrated UI image:

```bash
docker run \
  -e NODE_USE_ENV_PROXY=1 \
  -e HTTPS_PROXY=http://proxy.example:8080 \
  -e NO_PROXY=localhost,127.0.0.1 \
  <image>
```

This runtime setting works with both the standalone `edc-bff-stage` image and the production image when `CX_EDC_BFF_ENABLED=true`.

For a real connector, replace:

- `CX_EDC_DEFAULT_MANAGEMENT_URL` with your own consumer EDC Management API URL.
- `CX_EDC_DEFAULT_API_KEY` with the local Management API key, or, in OAuth2 mode, `CX_EDC_TOKEN_SERVER_ENDPOINT`,
  `CX_EDC_TOKEN_SERVER_CLIENT_ID`, and `CX_EDC_TOKEN_SERVER_CLIENT_SECRET` with your token server settings.
- `CX_EDC_ALLOWED_COUNTER_PARTY_ADDRESSES` with explicit provider DSP endpoint prefixes.

Example allowlist:

```bash
CX_EDC_ALLOWED_COUNTER_PARTY_ADDRESSES='https://counterparty-dsp.test/api/v1/dsp,https://other-counterparty-dsp.test/api/v1/dsp'
```

The wildcard is convenient for local testing, but avoid it for shared or production-like environments.

If port `3001` is already in use, either stop the existing process or choose another BFF port.

To find the process:

```bash
lsof -nP -iTCP:3001 -sTCP:LISTEN
```

To stop it:

```bash
kill <PID>
```

Or run the BFF on another port:

```bash
CX_EDC_BFF_PORT=3002 \
CX_EDC_BFF_AUTH_MODE=none \
CX_EDC_DEFAULT_MANAGEMENT_URL=http://localhost:8182/management \
CX_EDC_DEFAULT_API_KEY=<EDC_MANAGEMENT_API_KEY> \
CX_EDC_ALLOWED_COUNTER_PARTY_ADDRESSES='*' \
CX_EDC_ALLOW_INSECURE_COUNTER_PARTY_ADDRESSES=true \
pnpm bff:start
```

## 4. Run the UI Dev Server

In a second terminal, start Vite:

```bash
CX_EDC_BFF_UPSTREAM_URL=http://localhost:3001 pnpm dev
```

If you changed the BFF port, use the same port here:

```bash
CX_EDC_BFF_UPSTREAM_URL=http://localhost:3002 pnpm dev
```

The UI calls `/api/catena-x/edc/...`; Vite proxies those requests to the local BFF.

Open the UI, select the Catena-X infrastructure, and open CatenaXplorer. Choose a configured business partner or select **Use another partner…** and enter its counterparty ID and DSP address. Select **Load descriptors** to make the EDC request; changing the selection alone deliberately sends no request.

With editable endpoint configuration enabled, use **Settings → Manage Infrastructures** to manage multiple partners and their default. A successfully loaded runtime partner also offers **Save partner** in CatenaXplorer. Partner details are browser-local configuration, while Management API credentials and `CX_EDC_ALLOWED_COUNTER_PARTY_ADDRESSES` remain server-side.

## 5. Smoke Test Without a Real EDC

Status can be tested with only the BFF running, and it also shows which authentication mode is active:

```bash
curl http://localhost:3001/api/catena-x/edc/default/status
```

The response contains `"authMode": "api-key"` or `"authMode": "oauth2-client-credentials"` plus
`"authConfigured": true`, and never the secret itself.

For discovery and catalog requests without a real connector, run a tiny mock Management API in another terminal:

```bash
node - <<'NODE'
import http from 'node:http'

http.createServer(async (req, res) => {
  let body = ''
  for await (const chunk of req) body += chunk

  console.log(
    req.method,
    req.url,
    'authorization header present:',
    Boolean(req.headers.authorization),
    'x-api-key header present:',
    Boolean(req.headers['x-api-key']),
  )

  res.setHeader('content-type', 'application/json')

  if (req.url === '/management/v4alpha/connectordiscovery/connectors') {
    res.end(JSON.stringify([{
      'edc:counterPartyId': 'TEST_COUNTERPARTY_ID',
      'edc:counterPartyAddress': 'https://counterparty-dsp.test/api/v1/dsp/2025-1',
      'edc:protocol': 'dataspace-protocol-http:2025-1'
    }]))
    return
  }

  if (req.url === '/management/v4alpha/connectordiscovery/dspversionparams') {
    res.end(JSON.stringify({
      'edc:counterPartyId': 'TEST_COUNTERPARTY_ID',
      'edc:counterPartyAddress': 'https://counterparty-dsp.test/api/v1/dsp/2025-1',
      'edc:protocol': 'dataspace-protocol-http:2025-1'
    }))
    return
  }

  if (req.url === '/management/v3/catalog/request') {
    res.end(JSON.stringify({
      '@type': 'Catalog',
      participantId: 'TEST_COUNTERPARTY_ID',
      dataset: [{ '@id': 'mock-asset', '@type': 'Dataset' }]
    }))
    return
  }

  res.statusCode = 404
  res.end(JSON.stringify({ status: 404, error: 'not found', body }))
}).listen(8182, () => {
  console.log('Mock EDC Management API listening on http://localhost:8182/management')
})
NODE
```

Then use the BFF command from step 3 with:

```bash
CX_EDC_DEFAULT_MANAGEMENT_URL=http://localhost:8182/management
CX_EDC_ALLOWED_COUNTER_PARTY_ADDRESSES='*'
CX_EDC_ALLOW_INSECURE_COUNTER_PARTY_ADDRESSES=true
```

To exercise OAuth2 mode locally, add a mock token server in another terminal:

```bash
node - <<'NODE'
import http from 'node:http'

http.createServer(async (req, res) => {
  let body = ''
  for await (const chunk of req) body += chunk

  console.log(req.method, req.url, 'authorization header present:', Boolean(req.headers.authorization))

  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify({
    access_token: 'mock-access-token',
    token_type: 'Bearer',
    expires_in: 60,
  }))
}).listen(8183, () => {
  console.log('Mock token server listening on http://localhost:8183/token')
})
NODE
```

Start the BFF with `CX_EDC_TOKEN_SERVER_ENDPOINT=http://localhost:8183/token`,
`CX_EDC_ALLOW_INSECURE_TOKEN_SERVER_ENDPOINT=true`, and matching client ID and secret. The mock Management API above logs for each request whether an `Authorization` or `X-Api-Key` header
arrived, so you can see which mode is active. With `expires_in: 60` the BFF reuses the cached token, and the
mock token server logs a new token request roughly every 30 seconds while EDC calls continue.

The unit tests in `tests/server/edc-bff/managementAuth.test.ts` cover header construction, caching, refresh,
and every token endpoint error case without a running server.

## 6. Useful BFF Environment Variables

| Variable | Purpose |
| --- | --- |
| `CX_EDC_BFF_PORT` | BFF port, default `3001`. |
| `CX_EDC_BFF_AUTH_MODE` | `jwt` or `none`. Use `none` for local unauthenticated dev. |
| `CX_EDC_BFF_AUTH_JWKS_URL` | Required when `CX_EDC_BFF_AUTH_MODE=jwt`. |
| `CX_EDC_BFF_AUTH_ISSUER` | Optional JWT issuer check. |
| `CX_EDC_BFF_AUTH_AUDIENCE` | Optional JWT audience check. |
| `CX_EDC_BFF_REQUIRED_ROLES` | Comma-separated required roles/scopes. |
| `CX_EDC_DEFAULT_MANAGEMENT_URL` | Server-side consumer EDC Management API URL. |
| `CX_EDC_DEFAULT_API_KEY` | Server-side EDC Management API key. Selects API key mode. |
| `CX_EDC_DEFAULT_API_KEY_HEADER` | API key header, default `X-Api-Key`. |
| `CX_EDC_TOKEN_SERVER_ENDPOINT` | OAuth2 token endpoint. Selects OAuth2 client credentials mode. |
| `CX_EDC_TOKEN_SERVER_CLIENT_ID` | OAuth2 client ID, required in OAuth2 mode. |
| `CX_EDC_TOKEN_SERVER_CLIENT_SECRET` | OAuth2 client secret, required in OAuth2 mode. |
| `CX_EDC_ALLOW_INSECURE_TOKEN_SERVER_ENDPOINT` | Allows an `http://` token endpoint for local testing. |
| `CX_EDC_DEFAULT_PARTICIPANT_ID` | Optional own participant ID shown in status. |
| `CX_EDC_DEFAULT_DSP_ENDPOINT` | Optional own DSP endpoint metadata. |
| `CX_EDC_DEFAULT_DATA_PLANE_PROXY_URL` | Optional data plane proxy metadata for later phases. |
| `CX_EDC_ALLOWED_COUNTER_PARTY_ADDRESSES` | Comma-separated provider DSP endpoint prefixes or `*`. |
| `CX_EDC_ALLOW_INSECURE_COUNTER_PARTY_ADDRESSES` | Allows `http://` counterparty addresses for local testing. |
| `CX_EDC_REQUEST_TIMEOUT_MS` | Upstream EDC request timeout, default `30000`. |
| `CX_EDC_EDR_POLLING_ATTEMPTS` | EDR polling attempts, default `30`. |
| `CX_EDC_EDR_POLLING_INTERVAL_MS` | Delay between EDR polling attempts in milliseconds, default `2000`. |
| `NODE_USE_ENV_PROXY` | Set to `1` before Node.js starts to opt in to `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` and their lowercase equivalents for outgoing EDC requests. Local commands, VS Code, and container images leave proxy support disabled by default. |

For multiple proxy IDs, use `CX_EDC_PROXY_CONFIG_JSON` or `CX_EDC_PROXY_CONFIG_FILE`:

```json
{
  "proxies": {
    "default": {
      "managementUrl": "http://localhost:8182/management",
      "apiKey": "<EDC_MANAGEMENT_API_KEY>",
      "allowedCounterPartyAddresses": ["https://counterparty-dsp.test/api/v1/dsp"]
    },
    "partner-test": {
      "managementUrl": "https://consumer-test.example/management",
      "tokenServerEndpoint": "https://identity.example/realms/catena-x/protocol/openid-connect/token",
      "tokenServerClientId": "<EDC_TOKEN_CLIENT_ID>",
      "tokenServerClientSecret": "<EDC_TOKEN_CLIENT_SECRET>",
      "participantId": "TEST_PARTICIPANT_ID"
    }
  }
}
```

Each proxy picks its authentication mode independently, using the same selection rule.

The infrastructure `catenaX.edc.proxyId` selects one of these server-side proxy entries.
