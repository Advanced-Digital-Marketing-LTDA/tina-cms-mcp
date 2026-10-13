import { createServer, type Server } from "node:http";
import { generateKeyPair, exportJWK, SignJWT, type JWK } from "jose";

export async function createTestIssuer() {
  const { privateKey, publicKey } = await generateKeyPair("RS256", { modulusLength: 2048 });
  const jwk = await exportJWK(publicKey);
  Object.assign(jwk, { kid: "test-key", alg: "RS256", use: "sig" });
  let issuer = "";
  const server: Server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/.well-known/openid-configuration") {
      res.end(JSON.stringify({ issuer, jwks_uri: `${issuer}/jwks`, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token` }));
      return;
    }
    if (req.url === "/jwks") {
      res.end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test issuer failed to bind");
  issuer = `http://127.0.0.1:${address.port}`;
  return {
    issuer,
    server,
    privateKey,
    publicKey,
    async sign(claims: Record<string, unknown> = {}, key = privateKey) {
      const jwt = new SignJWT({ scope: "posts:read", ...claims })
        .setProtectedHeader({ alg: "RS256", kid: "test-key" });
      if (!("iss" in claims)) jwt.setIssuer(issuer);
      if (!("aud" in claims)) jwt.setAudience("https://mcp.example.test/mcp");
      if (!("sub" in claims)) jwt.setSubject("synthetic-user");
      jwt.setIssuedAt();
      if (!("exp" in claims)) jwt.setExpirationTime("5m");
      return jwt.sign(key);
    },
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
    jwk: jwk as JWK,
  };
}
