import { createMcpHandler } from "@modelcontextprotocol/server";
import { createServer, type Server } from "node:http";
import { Readable } from "node:stream";
import type { ServiceConfig } from "../config.js";
import { AuthError, type AccessTokenVerifier } from "../auth/token-verifier.js";
import { resourceMetadata, resourceMetadataUrl } from "../auth/resource-metadata.js";
import type { ProviderRegistry } from "../providers/provider-registry.js";
import { createMcpServer } from "../mcp/server.js";

const maxBodyBytes = 1_048_576;

class RequestBodyTooLargeError extends Error {}

type RequestHead = { url: URL; headers: Headers; method: string };

function getRequestHead(req: import("node:http").IncomingMessage): RequestHead {
  const host = req.headers.host ?? "localhost";
  const url = new URL(req.url ?? "/", `http://${host}`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((entry) => headers.append(key, entry));
    else if (value !== undefined) headers.set(key, value);
  }
  const method = req.method ?? "GET";
  return { url, headers, method };
}

function toWebRequest(head: RequestHead, req: import("node:http").IncomingMessage): Request {
  if (head.method === "GET" || head.method === "HEAD") {
    return new Request(head.url, { method: head.method, headers: head.headers });
  }
  const source = Readable.toWeb(req) as ReadableStream<Uint8Array>;
  let total = 0;
  const body = source.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      total += chunk.byteLength;
      if (total > maxBodyBytes) throw new RequestBodyTooLargeError("Request body too large");
      controller.enqueue(chunk);
    },
  }));
  return new Request(head.url, { method: head.method, headers: head.headers, body, duplex: "half" } as RequestInit & { duplex: "half" });
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
    let corsHeaders: Record<string, string> = {};
    try {
      const head = getRequestHead(nodeReq);
      const { url, headers, method } = head;
      const origin = headers.get("origin");
      const discardBody = () => {
        if (method !== "GET" && method !== "HEAD") nodeReq.resume();
      };
      const respondEarly = async (response: Response) => {
        discardBody();
        await writeResponse(nodeRes, response);
      };

      if (method === "OPTIONS") {
        if (origin && !config.allowedOrigins.includes(origin)) {
          await respondEarly(json(403, { error: "origin_not_allowed" }));
          return;
        }
        await respondEarly(new Response(null, { status: 204, headers: origin ? {
          "access-control-allow-origin": origin,
          "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
          "access-control-allow-headers": "authorization, content-type, mcp-protocol-version, mcp-session-id",
          "access-control-expose-headers": "www-authenticate, mcp-session-id, mcp-protocol-version",
          "access-control-max-age": "600",
          vary: "Origin",
        } : {} }));
        return;
      }

      if (url.pathname === new URL(metadataUrl).pathname || url.pathname === "/.well-known/oauth-protected-resource") {
        await respondEarly(method === "GET" ? json(200, resourceMetadata(config), { "access-control-allow-origin": "*" }) : json(405, { error: "method_not_allowed" }, { allow: "GET" }));
        return;
      }
      if (url.pathname !== config.mcpPath) {
        await respondEarly(json(404, { error: "not_found" }));
        return;
      }
      if (origin && !config.allowedOrigins.includes(origin)) {
        await respondEarly(json(403, { error: "origin_not_allowed" }));
        return;
      }
      corsHeaders = origin ? {
        "access-control-allow-origin": origin,
        "access-control-expose-headers": "www-authenticate, mcp-session-id, mcp-protocol-version",
        vary: "Origin",
      } : {};
      const authorization = headers.get("authorization") ?? "";
      const match = /^Bearer ([^\s]+)$/i.exec(authorization);
      if (!match) {
        await respondEarly(json(401, { error: "invalid_token" }, { ...corsHeaders, "www-authenticate": `Bearer resource_metadata="${metadataUrl}"` }));
        return;
      }
      let verified: Awaited<ReturnType<AccessTokenVerifier["verify"]>>;
      try {
        verified = await verifier.verify(match[1]!);
      } catch (error) {
        if (!(error instanceof AuthError)) throw error;
        await respondEarly(json(401, { error: "invalid_token" }, { ...corsHeaders, "www-authenticate": `Bearer error="invalid_token", resource_metadata="${metadataUrl}"` }));
        return;
      }
      const contentLength = headers.get("content-length");
      if (contentLength && Number(contentLength) > maxBodyBytes) {
        await respondEarly(json(413, { error: "request_too_large" }, corsHeaders));
        return;
      }
      const request = toWebRequest(head, nodeReq);
      const authInfo = {
        token: match[1]!,
        clientId: verified.subject,
        scopes: verified.scopes,
        expiresAt: verified.expiresAt,
        resource: verified.audience,
        extra: { subject: verified.subject },
      };
      const result = await mcp.fetch(request, { authInfo });
      for (const [name, value] of Object.entries(corsHeaders)) {
        result.headers.set(name, value);
      }
      await writeResponse(nodeRes, result);
    } catch (error) {
      if (nodeRes.headersSent) {
        nodeRes.destroy();
        return;
      }
      const status = error instanceof RequestBodyTooLargeError ? 413 : 500;
      await writeResponse(nodeRes, json(status, { error: status === 413 ? "request_too_large" : "internal_error" }, corsHeaders));
    }
  });
}
