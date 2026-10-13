import { afterEach, describe, expect, it, vi } from "vitest";
import { generateKeyPair } from "jose";
import { AuthError, createTokenVerifier } from "../../src/auth/token-verifier.js";
import { createTestIssuer } from "../helpers/test-issuer.js";

const issuers: Awaited<ReturnType<typeof createTestIssuer>>[] = [];
afterEach(async () => { await Promise.all(issuers.splice(0).map((issuer) => issuer.close())); });
async function setup() {
  const issuer = await createTestIssuer();
  issuers.push(issuer);
  const verifier = await createTokenVerifier({ issuer: issuer.issuer, audience: "https://mcp.example.test/mcp", port: 3000, allowedOrigins: [], mcpPath: "/mcp" });
  return { issuer, verifier };
}

describe("OAuth access token verification", () => {
  it("accepts valid read and write scopes and returns a verified principal", async () => {
    const { issuer, verifier } = await setup();
    const read = await verifier.verify(await issuer.sign({ scope: "posts:read" }));
    const write = await verifier.verify(await issuer.sign({ scope: "posts:write" }));
    expect(read.principal).toEqual({ subject: "synthetic-user", scopes: new Set(["posts:read"]) });
    expect(write.principal.scopes.has("posts:write")).toBe(true);
  });

  it("bounds issuer discovery with a ten-second abort signal", async () => {
    const issuer = await createTestIssuer();
    issuers.push(issuer);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    try {
      await createTokenVerifier({ issuer: issuer.issuer, audience: "https://mcp.example.test/mcp", port: 3000, allowedOrigins: [], mcpPath: "/mcp" });
      expect(timeoutSpy).toHaveBeenCalledWith(10_000);
      expect(fetchSpy).toHaveBeenCalledWith(
        `${issuer.issuer}/.well-known/openid-configuration`,
        { signal: expect.any(AbortSignal) },
      );
    } finally {
      fetchSpy.mockRestore();
      timeoutSpy.mockRestore();
    }
  });

  it("supports an issuer identifier with a trailing slash exactly as published", async () => {
    const issuer = await createTestIssuer({}, { trailingSlashIssuer: true });
    issuers.push(issuer);
    const configuredIssuer = `${issuer.issuer}/`;
    const verifier = await createTokenVerifier({ issuer: configuredIssuer, audience: "https://mcp.example.test/mcp", port: 3000, allowedOrigins: [], mcpPath: "/mcp" });
    const token = await issuer.sign({ iss: configuredIssuer });
    expect((await verifier.verify(token)).principal.subject).toBe("synthetic-user");
  });

  it("parses repeated whitespace between OAuth scopes without adding empty scopes", async () => {
    const { issuer, verifier } = await setup();
    const token = await issuer.sign({ scope: "posts:read  posts:write\t" });
    const verified = await verifier.verify(token);
    expect([...verified.principal.scopes].sort()).toEqual(["posts:read", "posts:write"]);
  });

  it.each([
    ["wrong issuer", (issuer: string) => ({ iss: `${issuer}/wrong` })],
    ["wrong audience", () => ({ aud: "https://other.example.test" })],
    ["multiple audiences", () => ({ aud: ["https://mcp.example.test/mcp", "https://other.example.test"] })],
    ["expired", () => ({ exp: 1 })],
    ["not yet valid", () => ({ nbf: Math.floor(Date.now() / 1000) + 3600 })],
    ["missing scope", () => ({ scope: undefined })],
    ["missing subject", () => ({ sub: undefined })],
    ["missing expiration", () => ({ exp: undefined })],
  ])("rejects %s", async (_label, claimsFor) => {
    const { issuer, verifier } = await setup();
    const token = await issuer.sign(claimsFor(issuer.issuer));
    await expect(verifier.verify(token)).rejects.toThrow("Invalid bearer token");
  });

  it("rejects a bad signature", async () => {
    const { issuer, verifier } = await setup();
    const { privateKey } = await generateKeyPair("RS256", { modulusLength: 2048 });
    await expect(verifier.verify(await issuer.sign({}, privateKey))).rejects.toThrow("Invalid bearer token");
  });

  it("fails closed when the configured discovery endpoint is unavailable", async () => {
    const issuer = await createTestIssuer();
    issuers.push(issuer);
    await expect(createTokenVerifier({ issuer: `${issuer.issuer}/wrong`, audience: "https://mcp.example.test/mcp", port: 3000, allowedOrigins: [], mcpPath: "/mcp" })).rejects.toThrow("Authorization server discovery failed");
  });

  it("rejects discovery metadata that declares a different issuer", async () => {
    const issuer = await createTestIssuer({ issuer: "https://evil.example.test" });
    issuers.push(issuer);
    await expect(createTokenVerifier({ issuer: issuer.issuer, audience: "https://mcp.example.test/mcp", port: 3000, allowedOrigins: [], mcpPath: "/mcp" })).rejects.toThrow("Authorization server metadata does not match configured issuer");
  });

  it("supports OIDC issuer URLs with path components", async () => {
    const issuer = await createTestIssuer({}, { issuerPath: "/issuer1" });
    issuers.push(issuer);
    const verifier = await createTokenVerifier({ issuer: issuer.issuer, audience: "https://mcp.example.test/mcp", port: 3000, allowedOrigins: [], mcpPath: "/mcp" });

    await expect(verifier.verify(await issuer.sign())).resolves.toMatchObject({ subject: "synthetic-user" });
  });

  it("rejects non-loopback HTTP JWKS URLs even in test mode", async () => {
    const issuer = await createTestIssuer({ jwks_uri: "http://keys.example.test/jwks" });
    issuers.push(issuer);
    await expect(createTokenVerifier({ issuer: issuer.issuer, audience: "https://mcp.example.test/mcp", port: 3000, allowedOrigins: [], mcpPath: "/mcp" })).rejects.toThrow("Authorization server JWKS URL must use HTTPS");
  });

  it("fails closed when discovery has no JWKS URI", async () => {
    const issuer = await createTestIssuer({ jwks_uri: undefined });
    issuers.push(issuer);
    await expect(createTokenVerifier({ issuer: issuer.issuer, audience: "https://mcp.example.test/mcp", port: 3000, allowedOrigins: [], mcpPath: "/mcp" })).rejects.toThrow("Authorization server metadata does not match configured issuer");
  });

  it("fails closed when discovery returns a non-success response", async () => {
    const issuer = await createTestIssuer({}, { discoveryStatus: 503 });
    issuers.push(issuer);
    await expect(createTokenVerifier({ issuer: issuer.issuer, audience: "https://mcp.example.test/mcp", port: 3000, allowedOrigins: [], mcpPath: "/mcp" })).rejects.toThrow("Authorization server discovery failed");
  });

  it("requires HTTPS for the JWKS endpoint outside tests", async () => {
    const issuer = await createTestIssuer();
    issuers.push(issuer);
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      await expect(createTokenVerifier({ issuer: issuer.issuer, audience: "https://mcp.example.test/mcp", port: 3000, allowedOrigins: [], mcpPath: "/mcp" })).rejects.toThrow("JWKS URL must use HTTPS");
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  it("gives invalid tokens a stable AuthError name and message", async () => {
    const { verifier } = await setup();
    try {
      await verifier.verify("not-a-token");
      throw new Error("expected token verification to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError);
      expect(error).toMatchObject({ name: "AuthError", message: "Invalid bearer token" });
    }
  });
});
