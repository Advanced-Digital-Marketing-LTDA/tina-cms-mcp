import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";

describe("loadConfig", () => {
  const validEnv = {
    NODE_ENV: "test",
    AUTH_ISSUER: "http://127.0.0.1:4321",
    AUTH_AUDIENCE: "https://mcp.example.test",
    PORT: "4317",
    ALLOWED_ORIGINS: "https://chat.example.test, http://localhost:3000",
  };

  it("rejects a missing issuer", () => {
    expect(() => loadConfig({ ...validEnv, AUTH_ISSUER: undefined })).toThrowError(
      expect.objectContaining({ code: "INVALID_CONFIGURATION" }),
    );
  });

  it("rejects a missing audience", () => {
    expect(() => loadConfig({ ...validEnv, AUTH_AUDIENCE: undefined })).toThrowError(
      expect.objectContaining({ code: "INVALID_CONFIGURATION" }),
    );
  });

  it("rejects a malformed issuer URL", () => {
    expect(() => loadConfig({ ...validEnv, AUTH_ISSUER: "not a URL" })).toThrowError(
      expect.objectContaining({ code: "INVALID_CONFIGURATION" }),
    );
  });

  it("requires HTTPS for a non-test issuer", () => {
    expect(() => loadConfig({ ...validEnv, NODE_ENV: "production" })).toThrowError(
      expect.objectContaining({ code: "INVALID_CONFIGURATION" }),
    );
  });

  it("rejects an invalid port", () => {
    expect(() => loadConfig({ ...validEnv, PORT: "70000" })).toThrowError(
      expect.objectContaining({ code: "INVALID_CONFIGURATION" }),
    );
  });

  it("parses valid configuration and comma-separated origins", () => {
    expect(loadConfig(validEnv)).toEqual({
      issuer: "http://127.0.0.1:4321",
      audience: "https://mcp.example.test",
      port: 4317,
      allowedOrigins: ["https://chat.example.test", "http://localhost:3000"],
      mcpPath: "/mcp",
    });
  });

  it("defaults an empty allowed-origin list to no browser origins", () => {
    expect(loadConfig({ ...validEnv, ALLOWED_ORIGINS: "" }).allowedOrigins).toEqual([]);
  });
});
