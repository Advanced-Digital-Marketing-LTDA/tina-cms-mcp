# Tina CMS MCP service foundation

This repository contains a standalone TypeScript MCP service foundation. It exposes draft-safe post management tools behind OAuth bearer-token verification and Streamable HTTP. It does not include a live CMS adapter, hosted service, scheduling workflow, publishing worker, or credentials.

## Requirements

- Node.js 24 or newer
- npm
- An OAuth authorization server that publishes OpenID Connect discovery metadata and a JWKS endpoint

## Local setup

```sh
npm ci
npm run check
npm run build
```

Set configuration through the process environment, then start the compiled service with `npm start`:

| Variable | Required | Meaning |
| --- | --- | --- |
| `AUTH_ISSUER` | Yes | Exact OAuth issuer URL. Its `/.well-known/openid-configuration` document must declare the same issuer and a JWKS URL. HTTPS is required outside tests. |
| `AUTH_AUDIENCE` | Yes | Exact resource identifier expected in access tokens, normally the MCP endpoint URL. |
| `PORT` | No | HTTP listen port, default `3000`. |
| `ALLOWED_ORIGINS` | No | Comma-separated exact browser Origins including scheme, host, and port. Empty means browser Origins are denied; requests without an Origin header remain supported. |

The service listens at `/mcp`. TLS should terminate at the later approved hosting layer. OAuth Protected Resource Metadata is available at the path-aware well-known URL for the configured audience, such as `/.well-known/oauth-protected-resource/mcp` when the audience ends in `/mcp`.

## Access and tools

The token must use the RS256 algorithm and contain a matching issuer, exact single audience, subject, expiration, a non-empty OAuth client ID (`client_id`, with `azp` as a fallback), and a space-delimited OAuth `scope` claim. The authenticated principal keeps the user subject separate from the client ID. The four tools are:

- `list_posts` and `get_post` require `posts:read`.
- `create_post` and `update_post` require `posts:write`.

Creation always makes a draft. Updates accept editable draft fields only and require a version from an earlier read. There is no tool for publishing or changing publication metadata.

## Provider boundary

The runtime starts with an empty provider registry. Calls return a structured `BACKEND_NOT_CONFIGURED` error until a separately reviewed adapter is supplied. The in-memory provider and its fabricated post fixtures exist only under `test/`; they are never selected by runtime configuration.

No real editorial text, site-specific URL, CMS credential, schedule storage, or publishing integration is included.

## Validation

```sh
npm run typecheck
npm test
npm run build
npm run mutation
```

The test suite uses locally generated RSA keys and local synthetic HTTP issuer endpoints. It does not call an external OAuth service. StrykerJS enforces an 80% mutation score threshold for configuration, domain, provider, auth, and tool code.
