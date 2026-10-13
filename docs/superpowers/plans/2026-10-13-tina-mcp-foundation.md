# TinaCMS MCP Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an independently runnable, authenticated TypeScript MCP service with four validated post-management tools and a provider boundary that fails truthfully when no live backend is configured.

**Architecture:** Use the official MCP TypeScript server SDK with a stateless Streamable HTTP endpoint. Keep post contracts, tool handlers, OAuth resource-server validation, and HTTP transport in focused modules. A test-only in-memory provider verifies the contracts; production configuration without an adapter returns `BACKEND_NOT_CONFIGURED`.

**Tech Stack:** Node.js LTS, npm, TypeScript, `@modelcontextprotocol/server` 2.3.1, Zod 4, `jose` for JWT verification, Vitest, StrykerJS.

**Spec:** `docs/superpowers/specs/2026-10-13-tina-mcp-foundation-design.md`

## Global Constraints

- Keep the separate MCP directory code-only: service code, docs, and fabricated fixtures only.
- Use `@modelcontextprotocol/server` 2.3.1; use its documented Streamable HTTP APIs and Zod 4 schemas.
- Expose only `list_posts`, `get_post`, `create_post`, and `update_post`; creation creates drafts and updates cannot publish.
- Require `posts:read` for list/get and `posts:write` for create/update.
- Require configured issuer and audience; fail closed on absent or invalid auth configuration and reject wrong issuer, audience, signature, validity times, or scope.
- No live provider is configured by default. Return a structured `BACKEND_NOT_CONFIGURED` tool error; never use the synthetic provider in runtime configuration.
- Do not add schedule metadata/storage, publish tools, a publishing worker, Drive import, Lippincott/site changes, production credentials, hosting setup, or deployment.
- No real editorial text, site URLs, or secrets in tests, fixtures, logs, or documentation.

## Review Focus

- Missing or malformed auth configuration: startup/config validation fails closed; cover in `test/auth/config.test.ts`.
- Wrong issuer/audience, expired or not-yet-valid token, or bad signature: HTTP rejects with 401; a valid token missing a required scope receives structured `FORBIDDEN` and does not call the provider. Cover in `test/auth/token-verifier.test.ts`, `test/tools/posts.test.ts`, and `test/http/mcp.test.ts`.
- Extra fields, malformed slugs, oversized content, and pagination outside bounds: reject as `VALIDATION`; cover in `test/tools/posts.test.ts`.
- No provider or a provider outage: tool returns the matching typed error and never a success-shaped result; cover in `test/tools/posts.test.ts` and `test/providers/provider-registry.test.ts`.
- Duplicate slug or stale version on update: map to `CONFLICT`, preserving existing data; cover in `test/providers/synthetic-provider.test.ts` and `test/tools/posts.test.ts`.

---

## File Map

- `package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.build.json`, `.gitignore`: standalone Node/TypeScript project and repeatable scripts.
- `src/config.ts`: validated environment configuration, including issuer, audience, endpoint, and port.
- `src/domain/post.ts`, `src/domain/errors.ts`: normalized post types, validation limits, and stable error codes.
- `src/providers/post-provider.ts`, `src/providers/provider-registry.ts`: adapter contract and configured-provider selection.
- `src/auth/principal.ts`, `src/auth/token-verifier.ts`, `src/auth/resource-metadata.ts`: verified principal type, fail-closed token verification, and OAuth Protected Resource Metadata.
- `src/tools/posts.ts`: the four tool schemas, authorization requirements, and provider/error mapping.
- `src/mcp/server.ts`: creates a fresh MCP server and registers the post tools for a request.
- `src/http/app.ts`, `src/index.ts`: Origin checks, OAuth challenge/metadata routes, Streamable HTTP endpoint, and process entry point.
- `test/fixtures/synthetic-posts.ts`, `test/helpers/synthetic-post-provider.ts`, `test/helpers/test-issuer.ts`: fabricated post data, test-only adapter, and a local-only test issuer/key pair.
- `test/auth/`, `test/providers/`, `test/tools/`, `test/http/`: auth, adapter, tool, and protocol tests.
- `vitest.config.ts`, `stryker.config.mjs`: automated test and mutation-test configuration.
- `README.md`: local setup, safe configuration, tool contracts, and explicit live-backend limitations.

## Validation Commands

Add these scripts in Task 1 and run them from `/workspace/tina-mcp-foundation` after dependencies are installed:

- `npm ci` — install exactly from `package-lock.json`.
- `npm run typecheck` — `tsc --noEmit -p tsconfig.json`.
- `npm test` — `vitest run`.
- `npm run build` — `tsc -p tsconfig.build.json`.
- `npm run check` — `npm run typecheck && npm test && npm run build`.
- `npm run mutation` — `stryker run`; require a mutation score of at least 80% for the configured source set.

### Task 1: Scaffold the standalone TypeScript service

**Files:** `package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.build.json`, `.gitignore`, `vitest.config.ts`, `stryker.config.mjs`, `src/config.ts`, `test/auth/config.test.ts`.

**Interfaces:** `loadConfig(env: NodeJS.ProcessEnv): ServiceConfig` validates `AUTH_ISSUER`, `AUTH_AUDIENCE`, `PORT`, and comma-separated `ALLOWED_ORIGINS`; missing or malformed issuer/audience must throw a typed configuration error. Permit HTTP issuer URLs only in test mode; require HTTPS otherwise. The service resource defaults to `/mcp`.

- [ ] **Step 1: Scaffold the local-only npm project** with ESM, strict TypeScript, Node LTS engine range, SDK 2.3.1, Zod 4, Vitest, `jose`, Stryker core plus command-runner, package scripts, and test configuration. Run `npm install --package-lock-only` to generate `package-lock.json`; initialize a local Git repository with no remote.
- [ ] **Step 2: Add failing config tests** for missing issuer, missing audience, malformed issuer URL, invalid port, valid test configuration, and explicit allowed-Origin parsing; assert the config error code and accepted values.
- [ ] **Step 3: Run `npm ci && npm test -- test/auth/config.test.ts` and verify the tests fail** because `loadConfig` is absent.
- [ ] **Step 4: Implement `loadConfig(env: NodeJS.ProcessEnv): ServiceConfig`** with validated `AUTH_ISSUER`, `AUTH_AUDIENCE`, `PORT`, and optional comma-separated `ALLOWED_ORIGINS` (empty defaults to no browser Origins allowed); require HTTPS issuer outside test mode. Configure Stryker's command runner to execute `npm test` and its `break` threshold to 80; initially target the source files added in later tasks.
- [ ] **Step 5: Run `npm run typecheck && npm test -- test/auth/config.test.ts` and verify they pass.**
- [ ] **Step 6: Commit** with `feat: scaffold standalone MCP service`.

### Task 2: Define post contracts and provider boundary

**Files:** `src/domain/post.ts`, `src/domain/errors.ts`, `src/auth/principal.ts`, `src/providers/post-provider.ts`, `src/providers/provider-registry.ts`, `test/fixtures/synthetic-posts.ts`, `test/helpers/synthetic-post-provider.ts`, `test/providers/provider-registry.test.ts`, `test/providers/synthetic-provider.test.ts`.

**Interfaces:**

- `PostStatus = "draft" | "published" | "archived"`.
- `PostDocument = { id: string; version: string; title: string; slug: string; bodyMarkdown: string; summary?: string; tags?: string[]; status: PostStatus; createdAt?: string; updatedAt?: string }`.
- `PostSummary = Pick<PostDocument, "id" | "version" | "title" | "slug" | "summary" | "tags" | "status" | "createdAt" | "updatedAt">`; list results do not include `bodyMarkdown`.
- `PostDraftInput = { title: string; slug: string; bodyMarkdown: string; summary?: string; tags?: string[] }`.
- `PostPatch = Partial<PostDraftInput>`.
- `PostQuery = { status?: PostStatus; limit: number; cursor?: string }`; `PostPage = { items: PostSummary[]; nextCursor: string | null }`.
- `PostProvider` exposes `list(query): Promise<PostPage>`, `get(id): Promise<PostDocument>`, `createDraft(input): Promise<PostDocument>`, and `updateDraft(id, expectedVersion, patch): Promise<PostDocument>`.
- `ProviderRegistry.get(): PostProvider | undefined`; no configured provider remains undefined.
- `PostError.code` is one of `NOT_FOUND | CONFLICT | BACKEND_UNAVAILABLE`; `ToolError.code` additionally includes `VALIDATION | BACKEND_NOT_CONFIGURED | FORBIDDEN`.
- `VerifiedPrincipal = { subject: string; scopes: ReadonlySet<string> }`, defined in `src/auth/principal.ts` and returned by Task 4 authentication.

- [ ] **Step 1: Write provider contract tests** for stable IDs/versions, draft-only creation, pagination cursors, unknown IDs, duplicate-slug conflicts, stale-version conflicts, published-post update rejection, and absent-provider lookup.
- [ ] **Step 2: Run `npm test -- test/providers` and verify the new tests fail.**
- [ ] **Step 3: Implement the normalized types, typed errors, provider port, registry, principal type, and test-only in-memory provider.** Use fabricated posts only; increment an opaque version on update, compare the supplied `expectedVersion`, reject updates to non-drafts, and reject duplicate slugs as `CONFLICT`.
- [ ] **Step 4: Run `npm run typecheck && npm test -- test/providers` and verify they pass.**
- [ ] **Step 5: Commit** with `feat: define post provider contract`.

### Task 3: Implement validated post tools

**Files:** `src/tools/posts.ts`, `src/mcp/server.ts`, `test/tools/posts.test.ts`.

**Interfaces:** `createMcpServer(registry: ProviderRegistry, principal: VerifiedPrincipal): McpServer`; register exactly four tools. Implement tool handlers against `PostProvider` only. Map provider errors to structured MCP tool errors with stable `code` fields.

- [ ] **Step 1: Write tool tests** for list/get/create/update success with the synthetic test provider; assert that create always has `status: "draft"`, update requires `expectedVersion`, and update input cannot set status or timestamps.
- [ ] **Step 2: Add failing validation/error tests** for unknown fields, title length 1–160, lowercase kebab slug length 1–120, Markdown body length ≤100,000, summary length ≤300, at most 20 tags of ≤40 characters, list limit 1–100, missing expected version, and an empty update patch. Assert `isError: true` and the corresponding structured code; list results omit `bodyMarkdown`.
- [ ] **Step 3: Run `npm test -- test/tools/posts.test.ts` and verify the tests fail.**
- [ ] **Step 4: Implement strict Zod 4 input schemas and handler mappings**: read tools require `posts:read`, write tools require `posts:write`; no provider maps to `BACKEND_NOT_CONFIGURED`; provider failures retain their typed code; unknown exceptions map to `BACKEND_UNAVAILABLE` without returning partial success.
- [ ] **Step 5: Run `npm run typecheck && npm test -- test/tools/posts.test.ts` and verify they pass.**
- [ ] **Step 6: Commit** with `feat: add validated post management tools`.

### Task 4: Add OAuth resource-server validation and Streamable HTTP

**Files:** `src/auth/token-verifier.ts`, `src/auth/resource-metadata.ts`, `src/http/app.ts`, `src/index.ts`, `test/helpers/test-issuer.ts`, `test/auth/token-verifier.test.ts`, `test/http/mcp.test.ts`.

**Interfaces:** `verifyAccessToken(token: string, issuer: string, audience: string): Promise<VerifiedPrincipal>` returns verified subject and scopes or throws `AuthError`; `createHttpServer(config: ServiceConfig, registry: ProviderRegistry): Server` returns a Node HTTP server. Discover OAuth issuer metadata, verify its declared issuer matches configuration, obtain its JWKS URI, and verify JWT signature, exact issuer, exact audience, expiry, and not-before using `jose`; the verifier extracts the space-delimited OAuth `scope` claim into `VerifiedPrincipal.scopes`.

- [ ] **Step 1: Write token tests** for a valid read token, valid write token, bad signature, wrong issuer, wrong audience, expired token, future `nbf`, missing `scope`, and missing read/write scope. Generate keys locally and serve fake discovery/JWKS endpoints from the test helper; make no external network calls.
- [ ] **Step 2: Run `npm test -- test/auth/token-verifier.test.ts` and verify the tests fail.**
- [ ] **Step 3: Implement fail-closed verification** using only configured issuer/audience, an explicit supported-algorithm allowlist, cached JWKS, and the standard OAuth `scope` claim. Do not bypass validation when metadata, keys, or auth settings are unavailable.
- [ ] **Step 4: Write HTTP protocol tests** for unauthenticated and invalid-token 401 plus `WWW-Authenticate`, valid-token requests that receive structured `FORBIDDEN` when their scope is insufficient, valid MCP initialization and `tools/list`, a successful synthetic `tools/call`, correct OAuth Protected Resource Metadata, rejection of malformed or unlisted `Origin` values, and tool calls returning `BACKEND_NOT_CONFIGURED` with no provider. Verify requests with no `Origin` header remain usable by non-browser MCP clients.
- [ ] **Step 5: Run `npm test -- test/http/mcp.test.ts` and verify the tests fail.**
- [ ] **Step 6: Implement the stateless Streamable HTTP endpoint at `/mcp`** with a fresh MCP server/transport per request, metadata discovery, OAuth challenges, and Origin validation. When an Origin header is present, require an exact configured scheme/host/port match; accept requests without an Origin header. Bind only to configured port; TLS terminates at the later approved host.
- [ ] **Step 7: Run `npm run typecheck && npm test -- test/auth/token-verifier.test.ts test/http/mcp.test.ts` and verify they pass.**
- [ ] **Step 8: Commit** with `feat: serve authenticated MCP over HTTP`.

### Task 5: Complete acceptance coverage and usage documentation

**Files:** `README.md`, `stryker.config.mjs`, `test/auth/`, `test/providers/`, `test/tools/`, `test/http/`.

- [ ] **Step 1: Add final cross-boundary tests** that prove all four tools are discoverable; every error code is preserved; the runtime has no implicit synthetic provider; no tool can publish; all fixtures are clearly fabricated; pagination and version-conflict invariants hold.
- [ ] **Step 2: Document local commands and configuration** in README, including required `AUTH_ISSUER`, `AUTH_AUDIENCE`, `PORT`, allowed Origins, `posts:read`/`posts:write`, metadata route, test-only synthetic provider, and the fact that no live CMS adapter or credentials are included.
- [ ] **Step 3: Set Stryker mutation scope** to `src/config.ts`, `src/domain/**/*.ts`, `src/providers/**/*.ts`, `src/auth/**/*.ts`, and `src/tools/**/*.ts`; require at least an 80% mutation score and exclude generated/build files.
- [ ] **Step 4: Run `npm ci && npm run check && npm run mutation`**; verify typecheck, unit/contract/protocol tests, build, and mutation threshold all pass.
- [ ] **Step 5: Review the final diff** for secrets, real post/site content, website references, schedule/publish features, and accidental network-dependent tests; correct any findings.
- [ ] **Step 6: Commit** with `test: cover MCP contract and mutation cases`.

## References

- [Official TypeScript SDK quickstart](https://modelcontextprotocol.io/docs/2026-07-28/develop/build-server)
- [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [MCP Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [StrykerJS documentation](https://stryker-mutator.io/docs/stryker-js/introduction/)

## Scope Self-Review

- Spec goal, protocol, tool contracts, OAuth validation, provider boundary, synthetic tests, and Stryker each map to Tasks 1–5.
- Scheduling, publishing, Drive, live backend provisioning, hosting, deployment, and website work remain explicitly outside the plan.
- The test issuer uses generated local keys and local endpoints only; no secret or external service is needed for automated tests.
