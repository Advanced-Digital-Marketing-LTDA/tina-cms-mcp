import { createServer, type Server } from "node:http";
import { generateKeyPair, exportJWK, SignJWT, type JWK } from "jose";

export async function createTestIssuer(
  discoveryOverrides: Record<string, unknown> = {},
  options: {
    trailingSlashIssuer?: boolean;
    discoveryStatus?: number;
    issuerPath?: string;
    discoveryRedirect?: { target?: string };
  } = {},
) {
  const { privateKey, publicKey } = await generateKeyPair("RS256", { modulusLength: 2048 });
  const jwk = await exportJWK(publicKey);
  Object.assign(jwk, { kid: "test-key", alg: "RS256", use: "sig" });
  let issuer = "";
  const server: Server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    const issuerPath = options.issuerPath ?? "";
    if (req.url === `${issuerPath}/.well-known/openid-configuration`) {
      if (options.discoveryRedirect?.target) {
        res.writeHead(302, { location: options.discoveryRedirect.target }).end();
        return;
      }
      const declaredIssuer = options.trailingSlashIssuer ? `${issuer}/` : issuer;
      res.writeHead(options.discoveryStatus ?? 200);
      res.end(JSON.stringify({ issuer: declaredIssuer, jwks_uri: `${issuer}/jwks`, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, ...discoveryOverrides }));
      return;
    }
    if (req.url === `${issuerPath}/jwks`) {
      res.end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test issuer failed to bind");
  issuer = `http://127.0.0.1:${address.port}${options.issuerPath ?? ""}`;
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
