import { Client } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { request as httpRequest } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createTokenVerifier } from "../../src/auth/token-verifier.js";
import { createHttpServer } from "../../src/http/app.js";
import { ProviderRegistry } from "../../src/providers/provider-registry.js";
import { InMemoryPostProvider } from "../helpers/synthetic-post-provider.js";
import { syntheticPosts } from "../fixtures/synthetic-posts.js";
import { createTestIssuer } from "../helpers/test-issuer.js";

const openServers: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(openServers.splice(0).map((close) => close())); });

async function setup(allowedOrigins: string[] = []) {
  const issuer = await createTestIssuer();
  const config = { issuer: issuer.issuer, audience: "https://mcp.example.test/mcp", port: 0, allowedOrigins, mcpPath: "/mcp" as const };
  const verifier = await createTokenVerifier(config);
  const registry = new ProviderRegistry(new InMemoryPostProvider(syntheticPosts));
  const server = createHttpServer(config, registry, verifier);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server failed to bind");
  openServers.push(async () => {
    await Promise.all([
      new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
      issuer.close(),
    ]);
  });
  return { issuer, server, baseUrl: `http://127.0.0.1:${address.port}` };
}

describe("authenticated stateless Streamable HTTP", () => {
  it("returns 401 with an OAuth challenge when unauthenticated or the token is invalid", async () => {
    const { baseUrl } = await setup();
    const missing = await fetch(`${baseUrl}/mcp`, { method: "POST" });
    expect(missing.status).toBe(401);
    expect(missing.headers.get("www-authenticate")).toContain("resource_metadata=");
    const invalid = await fetch(`${baseUrl}/mcp`, { method: "POST", headers: { authorization: "Bearer invalid" } });
    expect(invalid.status).toBe(401);
  });

  it("exposes OAuth challenge and MCP headers to an allowed browser Origin", async () => {
    const allowedOrigin = "https://allowed.example.test";
    const { baseUrl, issuer } = await setup([allowedOrigin]);
    const unauthenticated = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { origin: allowedOrigin },
    });
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers.get("access-control-allow-origin")).toBe(allowedOrigin);
    expect(unauthenticated.headers.get("access-control-expose-headers")).toContain("www-authenticate");
    expect(unauthenticated.headers.get("www-authenticate")).toContain("resource_metadata=");
    const invalidToken = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { origin: allowedOrigin, authorization: "Bearer invalid" },
    });
    expect(invalidToken.status).toBe(401);
    expect(invalidToken.headers.get("access-control-allow-origin")).toBe(allowedOrigin);
    expect(invalidToken.headers.get("www-authenticate")).toContain("error=\"invalid_token\"");

    const initialized = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        origin: allowedOrigin,
        authorization: `Bearer ${await issuer.sign()}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-03-26",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } },
      }),
    });
    expect(initialized.status).toBe(200);
    expect(initialized.headers.get("access-control-allow-origin")).toBe(allowedOrigin);
    expect(initialized.headers.get("access-control-expose-headers")).toContain("mcp-session-id");
    expect(initialized.headers.get("access-control-expose-headers")).toContain("mcp-protocol-version");
  });

  it("rejects an unauthenticated request without waiting for its body", async () => {
    const { baseUrl } = await setup(["https://allowed.example.test"]);
    const target = new URL(`${baseUrl}/mcp`);
    let request: ReturnType<typeof httpRequest> | undefined;
    try {
      const response = new Promise<number>((resolve, reject) => {
        request = httpRequest(target, { method: "POST", headers: { origin: "https://allowed.example.test", connection: "close" } }, (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode ?? 0));
        });
        request.on("error", reject);
        request.write("partial request body");
      });
      const timedOut = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("server waited for the request body")), 500));
      await expect(Promise.race([response, timedOut])).resolves.toBe(401);
    } finally {
      request?.end();
    }
  });

  it("rejects bodies larger than the configured request limit", async () => {
    const { baseUrl, issuer } = await setup();
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${await issuer.sign()}`, "content-type": "application/json" },
      body: "x".repeat(1_048_577),
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: "request_too_large" });
  });

  it("enforces the request limit for chunked bodies too", async () => {
    const { baseUrl, issuer } = await setup();
    const target = new URL(`${baseUrl}/mcp`);
    const token = await issuer.sign();
    const responsePromise = new Promise<number>((resolve, reject) => {
      const request = httpRequest(target, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", connection: "close" },
      }, (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
      });
      request.on("error", reject);
      request.end("x".repeat(1_048_577));
    });
    await expect(responsePromise).resolves.toBe(413);
  });

  it("serves Protected Resource Metadata", async () => {
    const { baseUrl } = await setup();
    const response = await fetch(`${baseUrl}/.well-known/oauth-protected-resource/mcp`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      resource: "https://mcp.example.test/mcp",
      authorization_servers: [expect.stringMatching(/^http:\/\//)],
      scopes_supported: ["posts:read", "posts:write"],
      bearer_methods_supported: ["header"],
    });
  });

  it("rejects unlisted and non-exact Origins while allowing no Origin", async () => {
    const { baseUrl, issuer } = await setup(["https://allowed.example.test"]);
    const denied = await fetch(`${baseUrl}/mcp`, { method: "POST", headers: { origin: "https://allowed.example.test:444" } });
    expect(denied.status).toBe(403);
    const token = await issuer.sign();
    const noOrigin = await fetch(`${baseUrl}/mcp`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: "{}" });
    expect(noOrigin.status).not.toBe(403);
  });

  it("supports initialization, tool discovery, synthetic calls, and scoped tool denial", async () => {
    const { baseUrl, issuer } = await setup();
    const client = new Client({ name: "synthetic-http-client", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), { authProvider: { token: () => issuer.sign({ scope: "posts:read posts:write" }) } });
    await client.connect(transport);
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual(["create_post", "get_post", "list_posts", "update_post"]);
      const read = await client.callTool({ name: "get_post", arguments: { id: "fixture-001" } });
      expect(read.structuredContent).toMatchObject({ id: "fixture-001", status: "draft" });
    } finally {
      await client.close();
    }

    const limited = new Client({ name: "synthetic-read-client", version: "1.0.0" });
    const readOnlyTransport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), { authProvider: { token: () => issuer.sign({ scope: "posts:read" }) } });
    await limited.connect(readOnlyTransport);
    try {
      const denied = await limited.callTool({ name: "create_post", arguments: { title: "Synthetic", slug: "synthetic", bodyMarkdown: "Synthetic" } });
      expect(denied).toMatchObject({ isError: true, structuredContent: { code: "FORBIDDEN" } });
    } finally {
      await limited.close();
    }
  });

  it("returns BACKEND_NOT_CONFIGURED from the runtime registry", async () => {
    const { baseUrl, issuer } = await setup();
    const noProvider = new ProviderRegistry();
    const verifier = await createTokenVerifier({ issuer: issuer.issuer, audience: "https://mcp.example.test/mcp", port: 0, allowedOrigins: [], mcpPath: "/mcp" });
    const server = createHttpServer({ issuer: issuer.issuer, audience: "https://mcp.example.test/mcp", port: 0, allowedOrigins: [], mcpPath: "/mcp" }, noProvider, verifier);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server failed to bind");
    openServers.push(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
    const client = new Client({ name: "synthetic-no-provider", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`), { authProvider: { token: () => issuer.sign() } });
    await client.connect(transport);
    try {
      const result = await client.callTool({ name: "list_posts", arguments: {} });
      expect(result).toMatchObject({ isError: true, structuredContent: { code: "BACKEND_NOT_CONFIGURED" } });
    } finally {
      await client.close();
    }
    expect(baseUrl).toContain("127.0.0.1");
  });
});
