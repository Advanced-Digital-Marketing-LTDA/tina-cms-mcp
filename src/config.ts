export type ServiceConfig = {
  issuer: string;
  audience: string;
  port: number;
  allowedOrigins: string[];
  mcpPath: "/mcp";
};

export class ConfigError extends Error {
  readonly code = "INVALID_CONFIGURATION";

  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function requiredUrl(
  name: string,
  value: string | undefined,
  allowHttp: boolean,
): string {
  if (!value) {
    throw new ConfigError(`${name} is required`);
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError(`${name} must be an absolute URL`);
  }

  if (
    (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new ConfigError(`${name} must be a secure URL without credentials, query, or fragment`);
  }

  return value;
}

function parseOrigins(value: string | undefined, allowHttp: boolean): string[] {
  if (!value?.trim()) {
    return [];
  }

  return value.split(",").map((item) => {
    const candidate = item.trim();
    let origin: URL;
    try {
      origin = new URL(candidate);
    } catch {
      throw new ConfigError("ALLOWED_ORIGINS must contain absolute origins");
    }

    if (
      (origin.protocol !== "https:" && !(allowHttp && origin.protocol === "http:")) ||
      origin.username.length > 0 ||
      origin.password.length > 0 ||
      origin.pathname !== "/" ||
      origin.search.length > 0 ||
      origin.hash.length > 0
    ) {
      throw new ConfigError("ALLOWED_ORIGINS entries must be HTTPS origins without paths or credentials");
    }

    return origin.origin;
  });
}

export function loadConfig(env: NodeJS.ProcessEnv): ServiceConfig {
  const allowHttp = env.NODE_ENV === "test";
  const issuer = requiredUrl("AUTH_ISSUER", env.AUTH_ISSUER, allowHttp);
  const audience = requiredUrl("AUTH_AUDIENCE", env.AUTH_AUDIENCE, allowHttp);

  const rawPort = env.PORT?.trim() || "3000";
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError("PORT must be an integer between 1 and 65535");
  }

  return {
    issuer,
    audience,
    port,
    allowedOrigins: parseOrigins(env.ALLOWED_ORIGINS, allowHttp),
    mcpPath: "/mcp",
  };
}
