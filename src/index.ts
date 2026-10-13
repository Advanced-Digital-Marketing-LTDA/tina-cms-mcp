import { loadConfig } from "./config.js";
import { createTokenVerifier } from "./auth/token-verifier.js";
import { ProviderRegistry } from "./providers/provider-registry.js";
import { createHttpServer } from "./http/app.js";

const config = loadConfig(process.env);
const verifier = await createTokenVerifier(config);
const server = createHttpServer(config, new ProviderRegistry(), verifier);
server.listen(config.port, "0.0.0.0", () => {
  process.stdout.write(`MCP service listening on port ${config.port}\n`);
});
