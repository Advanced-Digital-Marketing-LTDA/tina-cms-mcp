import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../../src/config.js";

describe("loadConfig", () => {
  const validEnv = {
    NODE_ENV: "test",
    AUTH_ISSUER: "http://127.0.0.1:4321",
    AUTH_AUDIENCE: "https://mcp.example.test",
    PORT: "4317",
    ALLOWED_ORIGINS: "https://chat.example.test, http://localhost:3000",
  };

  it("rejects a missing issuer", () => {
    expect(() => loadConfig({ ...validEnv, AUTH_ISSUER: undefined })).toThrow("AUTH_ISSUER is required");
  });

  it("rejects a missing audience", () => {
    expect(() => loadConfig({ ...validEnv, AUTH_AUDIENCE: undefined })).toThrow("AUTH_AUDIENCE is required");
  });

  it("rejects a malformed issuer URL", () => {
    expect(() => loadConfig({ ...validEnv, AUTH_ISSUER: "not a URL" })).toThrow("AUTH_ISSUER must be an absolute URL");
  });

  it("requires HTTPS for a non-test issuer", () => {
    expect(() => loadConfig({ ...validEnv, NODE_ENV: "production" })).toThrow("AUTH_ISSUER must be a secure URL");
  });

  it("allows test-mode HTTP endpoints only on loopback hosts", () => {
    expect(() => loadConfig({ ...validEnv, AUTH_ISSUER: "http://issuer.example.test" })).toThrowError(
      expect.objectContaining({ code: "INVALID_CONFIGURATION" }),
    );
    expect(() => loadConfig({ ...validEnv, ALLOWED_ORIGINS: "http://browser.example.test" })).toThrowError(
      expect.objectContaining({ code: "INVALID_CONFIGURATION" }),
    );
  });

  it("rejects an invalid port", () => {
    expect(() => loadConfig({ ...validEnv, PORT: "70000" })).toThrow("PORT must be an integer between 1 and 65535");
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

  it.each([
    ["issuer with an unsupported protocol", { AUTH_ISSUER: "ftp://issuer.example.test" }],
    ["issuer with embedded credentials", { AUTH_ISSUER: "https://user:pass@issuer.example.test" }],
    ["issuer with a query string", { AUTH_ISSUER: "https://issuer.example.test?debug=1" }],
    ["issuer with a fragment", { AUTH_ISSUER: "https://issuer.example.test#fragment" }],
    ["audience with an unsupported protocol", { AUTH_AUDIENCE: "ftp://resource.example.test" }],
    ["audience with embedded credentials", { AUTH_AUDIENCE: "https://user:pass@resource.example.test" }],
    ["audience with a query string", { AUTH_AUDIENCE: "https://resource.example.test?debug=1" }],
    ["audience with a fragment", { AUTH_AUDIENCE: "https://resource.example.test#fragment" }],
  ])("rejects an %s", (_caseName, overrides) => {
    try {
      loadConfig({ ...validEnv, ...overrides, NODE_ENV: "production" });
      throw new Error("expected invalid URL configuration to be rejected");
    } catch (error) {
      expect(error).toMatchObject({ name: "ConfigError", code: "INVALID_CONFIGURATION", message: expect.stringContaining("secure URL without credentials") });
    }
  });

  it.each([
    ["malformed", "not an origin"],
    ["unsupported protocol", "ftp://browser.example.test"],
    ["embedded credentials", "https://user:pass@browser.example.test"],
    ["a path", "https://browser.example.test/app"],
    ["a query", "https://browser.example.test?x=1"],
    ["a fragment", "https://browser.example.test#section"],
  ])("rejects an allowed Origin with %s", (_caseName, origin) => {
    try {
      loadConfig({ ...validEnv, ALLOWED_ORIGINS: origin });
      throw new Error("expected invalid Origin to be rejected");
    } catch (error) {
      const message = origin.startsWith("not ")
        ? "ALLOWED_ORIGINS must contain absolute origins"
        : "ALLOWED_ORIGINS entries must be HTTPS origins";
      expect(error).toMatchObject({ name: "ConfigError", code: "INVALID_CONFIGURATION", message: expect.stringContaining(message) });
    }
  });

  it("requires HTTPS for a non-test Origin and allows only test-mode localhost HTTP origins", () => {
    expect(() => loadConfig({ ...validEnv, NODE_ENV: "production", AUTH_ISSUER: "https://issuer.example.test", ALLOWED_ORIGINS: "http://localhost:3000" })).toThrowError(
      expect.objectContaining({ code: "INVALID_CONFIGURATION" }),
    );
    expect(loadConfig({ ...validEnv, ALLOWED_ORIGINS: "http://localhost:3000" }).allowedOrigins).toEqual(["http://localhost:3000"]);
  });

  it.each([
    ["zero", "0"],
    ["negative", "-1"],
    ["fractional", "3000.5"],
    ["non-numeric", "abc"],
    ["above maximum", "65536"],
  ])("rejects %s port values", (_caseName, port) => {
    expect(() => loadConfig({ ...validEnv, PORT: port })).toThrowError(
      expect.objectContaining({ code: "INVALID_CONFIGURATION" }),
    );
  });

  it("defaults a blank port to 3000 and accepts both boundary ports", () => {
    expect(loadConfig({ ...validEnv, PORT: " " }).port).toBe(3000);
    expect(loadConfig({ ...validEnv, PORT: "1" }).port).toBe(1);
    expect(loadConfig({ ...validEnv, PORT: "65535" }).port).toBe(65535);
  });

  it("treats whitespace-only allowed Origins as an empty list", () => {
    expect(loadConfig({ ...validEnv, ALLOWED_ORIGINS: "   " }).allowedOrigins).toEqual([]);
  });

  it("uses ConfigError with its stable name and code", () => {
    expect(new ConfigError("synthetic error")).toMatchObject({ name: "ConfigError", code: "INVALID_CONFIGURATION" });
  });
});
