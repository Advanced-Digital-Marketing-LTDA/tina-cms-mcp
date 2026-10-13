import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";
import { PostError, ToolError } from "../../src/domain/errors.js";
import { createMcpServer } from "../../src/mcp/server.js";
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

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      items: [{ id: "fixture-001", title: "Fabricated draft one" }],
      nextCursor: expect.any(String),
    });
    expect(JSON.stringify(result.structuredContent)).not.toContain("bodyMarkdown");
  });

  it("forwards optional status and cursor while using the default page size", async () => {
    const provider = {
      list: vi.fn<PostProvider["list"]>().mockResolvedValue({ items: [], nextCursor: null }),
    } as unknown as PostProvider;
    const result = await callTool(new ProviderRegistry(provider), principal, "list_posts", {
      status: "published",
      cursor: "cursor-1",
    });
    expect(result.isError).not.toBe(true);
    expect(provider.list).toHaveBeenCalledWith({ status: "published", limit: 20, cursor: "cursor-1" });
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
    expect(result.content).toEqual([{ type: "text", text: JSON.stringify(result.structuredContent) }]);
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

  it("advertises expectedVersion as required for updates", async () => {
    const server = createMcpServer(new ProviderRegistry(new InMemoryPostProvider(syntheticPosts)), principal);
    const client = new Client({ name: "synthetic-schema-client", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const tools = await client.listTools();
      const update = tools.tools.find((tool) => tool.name === "update_post");
      expect(update?.inputSchema.required).toContain("expectedVersion");
    } finally {
      await client.close();
      await server.close();
    }
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

    expect(result).toMatchObject({ isError: true, structuredContent: { code: "VALIDATION", message: expect.stringContaining("status") } });
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining("VALIDATION:") });
  });

  it("rejects invalid slugs with a structured VALIDATION error", async () => {
    const result = await callTool(
      new ProviderRegistry(new InMemoryPostProvider(syntheticPosts)),
      principal,
      "create_post",
      { title: "Bad slug", slug: "Not a slug", bodyMarkdown: "Synthetic." },
    );

    expect(result).toMatchObject({ isError: true, structuredContent: { code: "VALIDATION", message: expect.stringContaining("slug") } });
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

  it("rejects list limits outside 1 through 100 at the declared tool boundary", async () => {
    const result = await callTool(
      new ProviderRegistry(new InMemoryPostProvider(syntheticPosts)),
      principal,
      "list_posts",
      { limit: 101 },
    );

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
  });

  it("rejects an unsupported status at the declared tool boundary", async () => {
    const result = await callTool(
      new ProviderRegistry(new InMemoryPostProvider(syntheticPosts)),
      principal,
      "list_posts",
      { status: "scheduled", limit: 10 },
    );

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
  });

  it("rejects a missing expected version at the declared tool boundary", async () => {
    const result = await callTool(
      new ProviderRegistry(new InMemoryPostProvider(syntheticPosts)),
      principal,
      "update_post",
      { id: "fixture-001", patch: { title: "Update without a version" } },
    );

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
  });

  it("rejects an empty update patch", async () => {
    const result = await callTool(
      new ProviderRegistry(new InMemoryPostProvider(syntheticPosts)),
      principal,
      "update_post",
      { id: "fixture-001", expectedVersion: "1", patch: {} },
    );

    expect(result).toMatchObject({ isError: true, structuredContent: { code: "VALIDATION", message: expect.stringContaining("At least one editable field is required") } });
  });

  it.each(["status", "publishedAt", "updatedAt"])(
    "rejects publication metadata field %s at the declared update tool boundary",
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

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
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
      structuredContent: { code: "BACKEND_UNAVAILABLE", message: "The content provider is unavailable" },
      content: [{ text: "BACKEND_UNAVAILABLE: The content provider is unavailable" }],
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

  it.each([
    ["NOT_FOUND", new PostError("NOT_FOUND", "private provider detail"), "Post not found"],
    ["CONFLICT", new PostError("CONFLICT", "private provider detail"), "The post could not be changed because of a conflict"],
    ["BACKEND_UNAVAILABLE", new PostError("BACKEND_UNAVAILABLE", "private provider detail"), "The content provider is unavailable"],
    ["FORBIDDEN", new ToolError("FORBIDDEN", "Scope denied"), "Scope denied"],
  ] as const)("maps a typed %s error without leaking provider details", async (code, error, message) => {
    const provider = {
      list: vi.fn<PostProvider["list"]>().mockRejectedValue(error),
    } as unknown as PostProvider;
    const result = await callTool(new ProviderRegistry(provider), principal, "list_posts", {});
    expect(result).toMatchObject({ isError: true, structuredContent: { code, message } });
    if (error instanceof PostError) {
      expect(error.name).toBe("PostError");
      expect(JSON.stringify(result)).not.toContain("private provider detail");
    } else {
      expect(error.name).toBe("ToolError");
    }
  });

  it("omits absent optional draft fields from the provider input", async () => {
    const provider = {
      createDraft: vi.fn<PostProvider["createDraft"]>().mockResolvedValue({
        id: "synthetic-optional", version: "1", title: "Optional fields", slug: "optional-fields", bodyMarkdown: "", status: "draft",
      }),
    } as unknown as PostProvider;
    await callTool(new ProviderRegistry(provider), principal, "create_post", {
      title: "Optional fields", slug: "optional-fields", bodyMarkdown: "",
    });
    expect(provider.createDraft).toHaveBeenCalledWith({ title: "Optional fields", slug: "optional-fields", bodyMarkdown: "" });
  });

  it("normalizes a title and accepts fields at their documented maximum lengths", async () => {
    const provider = new InMemoryPostProvider();
    const result = await callTool(new ProviderRegistry(provider), principal, "create_post", {
      title: `  ${"x".repeat(158)}  `,
      slug: "valid-boundary",
      bodyMarkdown: "x".repeat(100_000),
      summary: "s".repeat(300),
      tags: Array.from({ length: 20 }, () => "t".repeat(40)),
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ title: "x".repeat(158), status: "draft" });
  });

  it("rejects malformed slugs with a valid prefix followed by punctuation", async () => {
    const result = await callTool(new ProviderRegistry(new InMemoryPostProvider()), principal, "create_post", {
      title: "Bad suffix", slug: "valid-prefix!", bodyMarkdown: "Synthetic.",
    });
    expect(result).toMatchObject({ isError: true, structuredContent: { code: "VALIDATION" } });
  });

  it("publishes four documented JSON schemas with no publication tool", async () => {
    const server = createMcpServer(new ProviderRegistry(new InMemoryPostProvider()), principal);
    const client = new Client({ name: "synthetic-schema-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const tools = (await client.listTools()).tools;
      expect(tools.map((tool) => tool.name).sort()).toEqual(["create_post", "get_post", "list_posts", "update_post"]);
      for (const tool of tools) {
        expect(tool.description?.length).toBeGreaterThan(10);
        expect(Object.keys(tool.inputSchema.properties ?? {}).length).toBeGreaterThan(0);
      }
      expect(tools.find((tool) => tool.name === "list_posts")?.inputSchema.properties).toHaveProperty("limit");
      const listSchema = tools.find((tool) => tool.name === "list_posts")?.inputSchema.properties;
      expect(listSchema?.status).toMatchObject({ enum: ["draft", "published", "archived"] });
      expect(listSchema?.limit).toMatchObject({ type: "integer", minimum: 1, maximum: 100 });
      expect(tools.find((tool) => tool.name === "get_post")?.inputSchema.properties).toHaveProperty("id");
      expect(tools.find((tool) => tool.name === "create_post")?.inputSchema.properties).toHaveProperty("bodyMarkdown");
      const updateSchema = tools.find((tool) => tool.name === "update_post")?.inputSchema.properties;
      expect(updateSchema).toHaveProperty("patch");
      const patchSchema = updateSchema?.patch as { properties?: Record<string, unknown>; additionalProperties?: unknown };
      expect(Object.keys(patchSchema.properties ?? {}).sort()).toEqual(["bodyMarkdown", "slug", "summary", "tags", "title"]);
      expect(patchSchema.additionalProperties).toBe(false);
      expect(patchSchema.properties?.title).toMatchObject({ type: "string", minLength: 1, maxLength: 160 });
      expect(patchSchema.properties?.bodyMarkdown).toMatchObject({ type: "string", maxLength: 100_000 });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
