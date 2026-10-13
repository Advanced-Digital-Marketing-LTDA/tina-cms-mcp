import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { ServiceConfig } from "../config.js";
import type { VerifiedPrincipal } from "./principal.js";

export class AuthError extends Error {
  constructor(message = "Invalid bearer token") {
    super(message);
    this.name = "AuthError";
  }
}

export type AccessTokenVerifier = {
  verify(token: string): Promise<{ principal: VerifiedPrincipal; subject: string; scopes: string[]; expiresAt: number; audience: URL }>;
};

type Discovery = { issuer?: unknown; jwks_uri?: unknown };

export async function createTokenVerifier(config: ServiceConfig): Promise<AccessTokenVerifier> {
  let metadata: Discovery;
  try {
    const discoveryUrl = `${config.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
    const response = await fetch(discoveryUrl, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error("discovery unavailable");
    metadata = await response.json() as Discovery;
  } catch {
    throw new AuthError("Authorization server discovery failed");
  }
  if (metadata.issuer !== config.issuer || typeof metadata.jwks_uri !== "string") {
    throw new AuthError("Authorization server metadata does not match configured issuer");
  }
  const jwksUrl = new URL(metadata.jwks_uri);
  if (jwksUrl.protocol !== "https:" && !(process.env.NODE_ENV === "test" && jwksUrl.protocol === "http:")) {
    throw new AuthError("Authorization server JWKS URL must use HTTPS");
  }
  const jwks = createRemoteJWKSet(jwksUrl);
  const expectedAudience = config.audience;
  return {
    async verify(token) {
      try {
        const result = await jwtVerify(token, jwks, {
          issuer: config.issuer,
          audience: expectedAudience,
          algorithms: ["RS256"],
        });
        const payload: JWTPayload = result.payload;
        const actualAudiences = typeof payload.aud === "string" ? [payload.aud] : payload.aud;
        if (!actualAudiences || actualAudiences.length !== 1 || actualAudiences[0] !== expectedAudience) {
          throw new Error("token audience must exactly match the configured resource");
        }
        if (typeof payload.sub !== "string" || typeof payload.scope !== "string" || typeof payload.exp !== "number") {
          throw new Error("required token claims are missing");
        }
        const scopes = payload.scope.split(/\s+/).filter(Boolean);
        return {
          principal: { subject: payload.sub, scopes: new Set(scopes) },
          subject: payload.sub,
          scopes,
          expiresAt: payload.exp,
          audience: new URL(expectedAudience),
        };
      } catch {
        throw new AuthError();
      }
    },
  };
}
