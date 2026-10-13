import { McpServer } from "@modelcontextprotocol/server";
import type { VerifiedPrincipal } from "../auth/principal.js";
import type { ProviderRegistry } from "../providers/provider-registry.js";
import { registerPostTools } from "../tools/posts.js";

export function createMcpServer(
  registry: ProviderRegistry,
  principal: VerifiedPrincipal,
): McpServer {
  const server = new McpServer({ name: "tina-cms-mcp", version: "0.1.0" });
  registerPostTools(server, registry, principal);
  return server;
}
