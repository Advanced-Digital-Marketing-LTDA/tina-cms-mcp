import { describe, expect, it } from "vitest";
import { ProviderRegistry } from "../../src/providers/provider-registry.js";
import type { PostProvider } from "../../src/providers/post-provider.js";

describe("ProviderRegistry", () => {
  it("has no provider when none is configured", () => {
    expect(new ProviderRegistry().get()).toBeUndefined();
  });

  it("returns the configured provider", () => {
    const provider = {} as PostProvider;

    expect(new ProviderRegistry(provider).get()).toBe(provider);
  });
});
