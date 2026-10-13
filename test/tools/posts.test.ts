import { describe, expect, it, vi } from "vitest";
import { PostError } from "../../src/domain/errors.js";
import type { PostProvider } from "../../src/providers/post-provider.js";
import { ProviderRegistry } from "../../src/providers/provider-registry.js";
import { syntheticPosts } from "../fixtures/synthetic-posts.js";
import { callTool } from "../helpers/call-tool.js";
import { InMemoryPostProvider } from "../helpers/synthetic-post-provider.js";

const readWriteScopes = new Set(["posts:read", "posts:write"]);
const principal = { subject: "synthetic-user", scopes: readWriteScopes };

describe("post MCP tools", () => {
  it("lists summaries with bounded pagination", async () => {
    const provider = new InMemoryPostProvider(syntheticPosts);
    const result = await callTool(new ProviderRegistry(provider), principal, "list_posts", { limit: 1 });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      items: [{ id: "fixture-001", title: "Fabricated draft one" }],
      nextCursor: expect.any(String),
    });
    expect(JSON.stringify(result.structuredContent)).not.toContain("bodyMarkdown");
  });

  it("gets a complete post by stable identifier", async () => {
    const provider = new InMemoryPostProvider(syntheticPosts);
    const result = await callTool(new ProviderRegistry(provider), principal, "get_post", {
      id: "fixture-001",
    });

    expect(result.structuredContent).toMatchObject({
      id: "fixture-001",
      bodyMarkdown: expect.any(String),
      version: "1",
    });
  });

  it("returns NOT_FOUND when the provider has no matching post", async () => {
    const result = await callTool(
      new ProviderRegistry(new InMemoryPostProvider(syntheticPosts)),
      principal,
      "get_post",
      { id: "missing-post" },
    );

    expect(result).toMatchObject({ isError: true, structuredContent: { code: "NOT_FOUND" } });
  });

  it("creates a draft and cannot set publication fields", async () => {
    const provider = new InMemoryPostProvider(syntheticPosts);
    const result = await callTool(new ProviderRegistry(provider), principal, "create_post", {
      title: "A fabricated MCP draft",
      slug: "fabricated-mcp-draft",
      bodyMarkdown: "Synthetic body for the tool contract.",
      summary: "A fake summary",
      tags: ["synthetic"],
    });

    expect(result.structuredContent).toMatchObject({
      id: expect.stringMatching(/^synthetic-/),
      title: "A fabricated MCP draft",
      status: "draft",
      version: "1",
    });
  });

  it("updates a draft only when the returned version token matches", async () => {
    const provider = new InMemoryPostProvider(syntheticPosts);
    const registry = new ProviderRegistry(provider);
    const result = await callTool(registry, principal, "update_post", {
      id: "fixture-001",
      expectedVersion: "1",
      patch: { title: "Updated synthetic title" },
    });

    expect(result.structuredContent).toMatchObject({
      id: "fixture-001",
      version: "2",
      title: "Updated synthetic title",
      status: "draft",
    });
  });

  it("returns CONFLICT when the update version is stale", async () => {
    const result = await callTool(
      new ProviderRegistry(new InMemoryPostProvider(syntheticPosts)),
      principal,
      "update_post",
      { id: "fixture-001", expectedVersion: "stale", patch: { title: "Must not apply" } },
    );

    expect(result).toMatchObject({ isError: true, structuredContent: { code: "CONFLICT" } });
  });

  it("rejects unknown fields with a structured VALIDATION error", async () => {
    const result = await callTool(
      new ProviderRegistry(new InMemoryPostProvider(syntheticPosts)),
      principal,
      "get_post",
      { id: "fixture-001", status: "published" },
    );

    expect(result).toMatchObject({ isError: true, structuredContent: { code: "VALIDATION" } });
  });

  it("rejects invalid slugs with a structured VALIDATION error", async () => {
    const result = await callTool(
      new ProviderRegistry(new InMemoryPostProvider(syntheticPosts)),
      principal,
      "create_post",
      { title: "Bad slug", slug: "Not a slug", bodyMarkdown: "Synthetic." },
    );

    expect(result).toMatchObject({ isError: true, structuredContent: { code: "VALIDATION" } });
  });

  it.each([
    ["title longer than 160 characters", { title: "x".repeat(161), slug: "long-title", bodyMarkdown: "" }],
    ["summary longer than 300 characters", { title: "Summary", slug: "long-summary", bodyMarkdown: "", summary: "x".repeat(301) }],
    ["more than 20 tags", { title: "Tags", slug: "too-many-tags", bodyMarkdown: "", tags: Array.from({ length: 21 }, (_, i) => `tag-${i}`) }],
    ["tag longer than 40 characters", { title: "Tag", slug: "long-tag", bodyMarkdown: "", tags: ["x".repeat(41)] }],
  ])("rejects %s", async (_description, args) => {
    const result = await callTool(
      new ProviderRegistry(new InMemoryPostProvider(syntheticPosts)),
      principal,
      "create_post",
      args,
    );

    expect(result).toMatchObject({ isError: true, structuredContent: { code: "VALIDATION" } });
  });

  it("rejects bodies that exceed the content limit", async () => {
    const result = await callTool(
      new ProviderRegistry(new InMemoryPostProvider(syntheticPosts)),
      principal,
      "create_post",
      { title: "Large body", slug: "large-body", bodyMarkdown: "x".repeat(100_001) },
    );

    expect(result).toMatchObject({ isError: true, structuredContent: { code: "VALIDATION" } });
  });

  it("rejects list limits outside 1 through 100", async () => {
    const result = await callTool(
      new ProviderRegistry(new InMemoryPostProvider(syntheticPosts)),
      principal,
      "list_posts",
      { limit: 101 },
    );

    expect(result).toMatchObject({ isError: true, structuredContent: { code: "VALIDATION" } });
  });

  it("rejects an unsupported status filter with a structured VALIDATION error", async () => {
    const result = await callTool(
      new ProviderRegistry(new InMemoryPostProvider(syntheticPosts)),
      principal,
      "list_posts",
      { status: "scheduled", limit: 10 },
    );

    expect(result).toMatchObject({ isError: true, structuredContent: { code: "VALIDATION" } });
  });

  it("rejects a missing expected version with a structured VALIDATION error", async () => {
    const result = await callTool(
      new ProviderRegistry(new InMemoryPostProvider(syntheticPosts)),
      principal,
      "update_post",
      { id: "fixture-001", patch: { title: "Update without a version" } },
    );

    expect(result).toMatchObject({ isError: true, structuredContent: { code: "VALIDATION" } });
  });

  it("rejects an empty update patch", async () => {
    const result = await callTool(
      new ProviderRegistry(new InMemoryPostProvider(syntheticPosts)),
      principal,
      "update_post",
      { id: "fixture-001", expectedVersion: "1", patch: {} },
    );

    expect(result).toMatchObject({ isError: true, structuredContent: { code: "VALIDATION" } });
  });

  it.each(["status", "publishedAt", "updatedAt"])(
    "rejects publication metadata field %s in an update patch",
    async (field) => {
      const result = await callTool(
        new ProviderRegistry(new InMemoryPostProvider(syntheticPosts)),
        principal,
        "update_post",
        {
          id: "fixture-001",
          expectedVersion: "1",
          patch: { [field]: "published" },
        },
      );

      expect(result).toMatchObject({ isError: true, structuredContent: { code: "VALIDATION" } });
    },
  );

  it("returns BACKEND_NOT_CONFIGURED without a provider", async () => {
    const result = await callTool(new ProviderRegistry(), principal, "list_posts", { limit: 10 });

    expect(result).toMatchObject({
      isError: true,
      structuredContent: { code: "BACKEND_NOT_CONFIGURED" },
    });
  });

  it("checks scopes before invoking the provider", async () => {
    const provider = {
      list: vi.fn<PostProvider["list"]>(),
    } as unknown as PostProvider;
    const result = await callTool(
      new ProviderRegistry(provider),
      { subject: "synthetic-user", scopes: new Set(["posts:write"]) },
      "list_posts",
      { limit: 10 },
    );

    expect(result).toMatchObject({ isError: true, structuredContent: { code: "FORBIDDEN" } });
    expect(provider.list).not.toHaveBeenCalled();
  });

  it("requires write scope before creating a draft", async () => {
    const provider = {
      createDraft: vi.fn<PostProvider["createDraft"]>(),
    } as unknown as PostProvider;
    const result = await callTool(
      new ProviderRegistry(provider),
      { subject: "synthetic-user", scopes: new Set(["posts:read"]) },
      "create_post",
      { title: "Forbidden synthetic draft", slug: "forbidden-draft", bodyMarkdown: "" },
    );

    expect(result).toMatchObject({ isError: true, structuredContent: { code: "FORBIDDEN" } });
    expect(provider.createDraft).not.toHaveBeenCalled();
  });

  it("preserves typed provider failures and maps unexpected failures", async () => {
    const typedFailure = {
      list: vi.fn<PostProvider["list"]>().mockRejectedValue(
        new PostError("BACKEND_UNAVAILABLE", "Synthetic outage"),
      ),
    } as unknown as PostProvider;
    const unavailable = await callTool(
      new ProviderRegistry(typedFailure),
      principal,
      "list_posts",
      { limit: 10 },
    );
    expect(unavailable).toMatchObject({
      isError: true,
      structuredContent: { code: "BACKEND_UNAVAILABLE" },
    });

    const unknownFailure = {
      list: vi.fn<PostProvider["list"]>().mockRejectedValue(new Error("Internal detail")),
    } as unknown as PostProvider;
    const masked = await callTool(
      new ProviderRegistry(unknownFailure),
      principal,
      "list_posts",
      { limit: 10 },
    );
    expect(masked).toMatchObject({
      isError: true,
      structuredContent: { code: "BACKEND_UNAVAILABLE" },
    });
    expect(JSON.stringify(masked)).not.toContain("Internal detail");
  });
});
