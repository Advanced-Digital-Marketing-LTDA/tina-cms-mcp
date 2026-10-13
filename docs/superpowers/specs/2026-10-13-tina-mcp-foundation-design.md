# TinaCMS MCP foundation — design spec

**Status:** Proposed for owner review  
**Scope approval:** Andrew approved the MCP-only scope on 2026-10-13.

## Goal

Create a standalone, code-only TypeScript MCP service that exposes validated post-management tools through authenticated remote MCP. The service must work honestly when no content provider is configured: requests then return a typed `BACKEND_NOT_CONFIGURED` error. Tests use invented posts and a test-only in-memory adapter; no real blog content or credentials enter this repository.

## Protocol and runtime

- Use the official TypeScript MCP SDK package `@modelcontextprotocol/server`, pinning a reviewed version. Version 2.3.1 is the latest upstream release verified on 2026-10-13.
- Serve MCP over HTTPS using Streamable HTTP at one configurable endpoint (default `/mcp`). Validate the `Origin` header on HTTP requests and support MCP initialization, capability negotiation, tool discovery, and tool calls. Do not offer stdio as the hosted product interface.
- Keep request handling stateless unless a future feature demonstrates a need for MCP sessions. A provider adapter may maintain its own connection pool, but requests must not depend on process-local conversation state.

## Authentication

Act as an OAuth-protected resource server; do not implement an identity provider or custom login. Require bearer access tokens. Configure the trusted issuer and this MCP server's audience/resource identifier at deployment. Validate token signature against issuer metadata/JWKS, exact issuer and audience, validity times, and required scopes. Reject missing/invalid configuration and invalid tokens closed; never accept a token issued for another resource.

Publish OAuth Protected Resource Metadata and the appropriate `WWW-Authenticate` challenge so a compatible MCP client can discover the authorization server. Require HTTPS in deployment. Use separate `posts:read` and `posts:write` scopes. The authorization-server vendor and tenant are deliberately not selected here; ChatGPT/client-registration compatibility must be checked when deployment is approved.

## Post tool contract

Expose four MCP tools:

- `list_posts`: optional status filter and bounded pagination; returns post summaries plus an opaque continuation cursor.
- `get_post`: fetch by stable provider ID; returns the normalized post or `NOT_FOUND`.
- `create_post`: create a draft from a validated title, slug, Markdown body, and optional summary/tags; return the normalized created post.
- `update_post`: apply a validated partial update to a draft by stable ID. Require the version token returned by reads to prevent silent lost updates; report stale versions as `CONFLICT`.

The provider-neutral post representation contains stable `id`, `version`, `title`, `slug`, `bodyMarkdown`, optional `summary` and `tags`, a read-only content status (`draft`, `published`, or `archived`), and read-only timestamps when supplied by the provider. Adapters translate this representation to and from provider-native fields. Creation always creates a draft. These tools cannot change publication status.

Validate all inputs at the MCP boundary, including string bounds, slug format, tag limits, pagination limits, and unknown fields. Require `posts:read` for list/get and `posts:write` for create/update. Return structured tool errors with stable codes: `VALIDATION`, `NOT_FOUND`, `CONFLICT`, `BACKEND_NOT_CONFIGURED`, `FORBIDDEN`, and `BACKEND_UNAVAILABLE`. A failed or unavailable provider operation must never be reported as success.

## Provider boundary

Define a provider port for list, get, create-draft, and update-draft, with explicit capability reporting and typed failures. Register only configured provider adapters. Include a synthetic in-memory adapter for automated contract tests, clearly isolated from production configuration; do not silently use it as a live backend. A live TinaCMS/content-source adapter needs an approved target, credentials, and field mapping before it can be configured. The port must not assume a schedule database or publication worker.

## Verification and acceptance

- Synthetic contract tests exercise valid and invalid requests, pagination, version conflicts, adapter conversion, each typed backend failure, and behavior with no adapter configured.
- Protocol tests cover initialization, tool discovery, authenticated and unauthenticated requests, scope enforcement, origin rejection, and protected-resource metadata.
- Run StrykerJS mutation testing over validation, mapping, authorization, and error translation; set and enforce a documented mutation score threshold before merge.
- No test depends on real Lippincott copy, URLs, credentials, a production CMS, or network access. Tests assert behavior and data invariants, never exact editorial wording.
- Repository contains only service code, documentation, and fabricated fixtures. No live content operation may succeed until a real adapter is deliberately configured.

## Explicitly deferred

No blog or website changes; no Google Drive access/import; no scheduling/rescheduling/cancellation metadata or persistence; no `publish_now`; no publishing/deployment worker or status; no production CMS credentials, publication, hosting setup, repository creation, or deployment. Do not create a private repository for schedules.

## Decisions required before live use

1. Select and approve the first content provider/target and its field mapping, then supply credentials through the approved deployment secret manager.
2. Approve a hosting environment and configure its HTTPS endpoint, OAuth issuer, audience, and read/write scopes. No OAuth vendor is selected by this spec.

## References

- [MCP TypeScript SDK releases](https://github.com/modelcontextprotocol/typescript-sdk/releases) — confirms `@modelcontextprotocol/server` 2.3.1 as latest on the spec date.
- [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [MCP Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [StrykerJS documentation](https://stryker-mutator.io/docs/stryker-js/introduction/)
