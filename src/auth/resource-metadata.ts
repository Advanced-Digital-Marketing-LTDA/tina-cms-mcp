import { getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/server";
import type { ServiceConfig } from "../config.js";

export function resourceMetadataUrl(config: ServiceConfig): string {
  return getOAuthProtectedResourceMetadataUrl(new URL(config.audience));
}

export function resourceMetadata(config: ServiceConfig): Record<string, unknown> {
  return {
    resource: config.audience,
    authorization_servers: [config.issuer],
    scopes_supported: ["posts:read", "posts:write"],
    bearer_methods_supported: ["header"],
  };
}
