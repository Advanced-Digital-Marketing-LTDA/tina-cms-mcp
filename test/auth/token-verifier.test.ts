import { afterEach, describe, expect, it } from "vitest";
import { generateKeyPair } from "jose";
import { createTokenVerifier } from "../../src/auth/token-verifier.js";
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

  it.each([
    ["wrong issuer", (issuer: string) => ({ iss: `${issuer}/wrong` })],
    ["wrong audience", () => ({ aud: "https://other.example.test" })],
    ["expired", () => ({ exp: 1 })],
    ["not yet valid", () => ({ nbf: Math.floor(Date.now() / 1000) + 3600 })],
    ["missing scope", () => ({ scope: undefined })],
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

  it("fails closed when discovery declares another issuer", async () => {
    const issuer = await createTestIssuer();
    issuers.push(issuer);
    await expect(createTokenVerifier({ issuer: `${issuer.issuer}/wrong`, audience: "https://mcp.example.test/mcp", port: 3000, allowedOrigins: [], mcpPath: "/mcp" })).rejects.toThrow("Authorization server discovery failed");
  });
});
