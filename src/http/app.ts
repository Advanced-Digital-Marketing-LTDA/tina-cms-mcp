import { createMcpHandler } from "@modelcontextprotocol/server";
import { createServer, type Server } from "node:http";
import type { ServiceConfig } from "../config.js";
import { AuthError, type AccessTokenVerifier } from "../auth/token-verifier.js";
import { resourceMetadata, resourceMetadataUrl } from "../auth/resource-metadata.js";
import type { ProviderRegistry } from "../providers/provider-registry.js";
import { createMcpServer } from "../mcp/server.js";

const maxBodyBytes = 1_048_576;

async function toWebRequest(req: import("node:http").IncomingMessage): Promise<Request> {
  const host = req.headers.host ?? "localhost";
  const url = new URL(req.url ?? "/", `http://${host}`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((entry) => headers.append(key, entry));
    else if (value !== undefined) headers.set(key, value);
  }
  const method = req.method ?? "GET";
  if (method === "GET" || method === "HEAD") return new Request(url, { method, headers });
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBodyBytes) throw new Error("Request body too large");
    chunks.push(buffer);
  }
  return new Request(url, { method, headers, body: Buffer.concat(chunks) });
}

async function writeResponse(res: import("node:http").ServerResponse, response: Response): Promise<void> {
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  if (!response.body) {
    res.end();
    return;
  }
  for await (const chunk of response.body) res.write(Buffer.from(chunk));
  res.end();
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

export function createHttpServer(
  config: ServiceConfig,
  registry: ProviderRegistry,
  verifier: AccessTokenVerifier,
): Server {
  const mcp = createMcpHandler(({ authInfo }) => {
    const principal = {
      subject: authInfo?.clientId ?? "",
      scopes: new Set(authInfo?.scopes ?? []),
    };
    return createMcpServer(registry, principal);
  });
  const metadataUrl = resourceMetadataUrl(config);

  return createServer(async (nodeReq, nodeRes) => {
    try {
      const request = await toWebRequest(nodeReq);
      const url = new URL(request.url);
      if (request.method === "OPTIONS") {
        const origin = request.headers.get("origin");
        if (origin && !config.allowedOrigins.includes(origin)) {
          await writeResponse(nodeRes, json(403, { error: "origin_not_allowed" }));
          return;
        }
        await writeResponse(nodeRes, new Response(null, { status: 204, headers: origin ? {
          "access-control-allow-origin": origin,
          "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
          "access-control-allow-headers": "authorization, content-type, mcp-protocol-version, mcp-session-id",
          "access-control-max-age": "600",
          vary: "Origin",
        } : {} }));
        return;
      }

      if (url.pathname === new URL(metadataUrl).pathname || url.pathname === "/.well-known/oauth-protected-resource") {
        await writeResponse(nodeRes, request.method === "GET" ? json(200, resourceMetadata(config), { "access-control-allow-origin": "*" }) : json(405, { error: "method_not_allowed" }, { allow: "GET" }));
        return;
      }
      if (url.pathname !== config.mcpPath) {
        await writeResponse(nodeRes, json(404, { error: "not_found" }));
        return;
      }
      const origin = request.headers.get("origin");
      if (origin && !config.allowedOrigins.includes(origin)) {
        await writeResponse(nodeRes, json(403, { error: "origin_not_allowed" }));
        return;
      }
      const authorization = request.headers.get("authorization") ?? "";
      const match = /^Bearer ([^\s]+)$/i.exec(authorization);
      if (!match) {
        await writeResponse(nodeRes, json(401, { error: "invalid_token" }, { "www-authenticate": `Bearer resource_metadata="${metadataUrl}"` }));
        return;
      }
      let verified: Awaited<ReturnType<AccessTokenVerifier["verify"]>>;
      try {
        verified = await verifier.verify(match[1]!);
      } catch (error) {
        if (!(error instanceof AuthError)) throw error;
        await writeResponse(nodeRes, json(401, { error: "invalid_token" }, { "www-authenticate": `Bearer error="invalid_token", resource_metadata="${metadataUrl}"` }));
        return;
      }
      const authInfo = {
        token: match[1]!,
        clientId: verified.subject,
        scopes: verified.scopes,
        expiresAt: verified.expiresAt,
        resource: verified.audience,
        extra: { subject: verified.subject },
      };
      const result = await mcp.fetch(request, { authInfo });
      if (origin) {
        result.headers.set("access-control-allow-origin", origin);
        result.headers.set("vary", "Origin");
      }
      await writeResponse(nodeRes, result);
    } catch (error) {
      const status = error instanceof Error && error.message === "Request body too large" ? 413 : 500;
      await writeResponse(nodeRes, json(status, { error: status === 413 ? "request_too_large" : "internal_error" }));
    }
  });
}
