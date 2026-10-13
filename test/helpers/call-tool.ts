import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createMcpServer } from "../../src/mcp/server.js";
import type { ProviderRegistry } from "../../src/providers/provider-registry.js";
import type { VerifiedPrincipal } from "../../src/auth/principal.js";

export async function callTool(
  registry: ProviderRegistry,
  principal: VerifiedPrincipal,
  name: string,
  args: Record<string, unknown>,
) {
  const server = createMcpServer(registry, principal);
  const client = new Client({ name: "synthetic-test-client", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    return await client.callTool({ name, arguments: args });
  } finally {
    await client.close();
    await server.close();
  }
}
