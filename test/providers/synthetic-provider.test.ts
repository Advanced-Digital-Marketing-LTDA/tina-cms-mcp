import { describe, expect, it } from "vitest";
import { InMemoryPostProvider } from "../helpers/synthetic-post-provider.js";
import { syntheticPosts } from "../fixtures/synthetic-posts.js";

describe("InMemoryPostProvider contract", () => {
  it("returns summaries without post bodies", async () => {
    const provider = new InMemoryPostProvider(syntheticPosts);

    const page = await provider.list({ limit: 2 });

    expect(page.items.map(({ id }) => id)).toEqual(["fixture-001", "fixture-002"]);
    expect(page.items[0]).not.toHaveProperty("bodyMarkdown");
  });

  it("continues pagination from the returned cursor", async () => {
    const provider = new InMemoryPostProvider(syntheticPosts);

    const first = await provider.list({ limit: 2 });
    const second = await provider.list({
      limit: 2,
      ...(first.nextCursor ? { cursor: first.nextCursor } : {}),
    });

    expect(first.nextCursor).not.toBeNull();
    expect(second.items.map(({ id }) => id)).toEqual(["fixture-003"]);
    expect(second.nextCursor).toBeNull();
  });

  it("filters by read-only content status", async () => {
    const provider = new InMemoryPostProvider(syntheticPosts);

    const page = await provider.list({ limit: 10, status: "published" });

    expect(page.items.map(({ id }) => id)).toEqual(["fixture-002"]);
  });

  it("returns NOT_FOUND for an unknown identifier", async () => {
    const provider = new InMemoryPostProvider(syntheticPosts);

    await expect(provider.get("missing")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("creates a draft with a stable identifier and initial version", async () => {
    const provider = new InMemoryPostProvider(syntheticPosts);

    const created = await provider.createDraft({
      title: "Synthetic created post",
      slug: "synthetic-created-post",
      bodyMarkdown: "Created only for a unit test.",
    });

    expect(created.id).toMatch(/^synthetic-/);
    expect(created.version).toBe("1");
    expect(created.status).toBe("draft");
  });

  it("rejects duplicate slugs without changing existing posts", async () => {
    const provider = new InMemoryPostProvider(syntheticPosts);

    await expect(
      provider.createDraft({
        title: "Duplicate synthetic post",
        slug: "fabricated-draft-one",
        bodyMarkdown: "This must not replace the first fixture.",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(provider.get("fixture-001")).resolves.toMatchObject({
      title: "Fabricated draft one",
      version: "1",
    });
  });

  it("updates a draft when the version token matches", async () => {
    const provider = new InMemoryPostProvider(syntheticPosts);

    const updated = await provider.updateDraft(
      "fixture-001",
      "1",
      { title: "Revised synthetic title" },
    );

    expect(updated).toMatchObject({
      title: "Revised synthetic title",
      slug: "fabricated-draft-one",
      status: "draft",
      version: "2",
    });
  });

  it("preserves a draft when an update uses a stale version", async () => {
    const provider = new InMemoryPostProvider(syntheticPosts);

    await expect(
      provider.updateDraft("fixture-001", "stale", { title: "Must not apply" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(provider.get("fixture-001")).resolves.toMatchObject({
      title: "Fabricated draft one",
      version: "1",
    });
  });

  it("refuses updates to published posts", async () => {
    const provider = new InMemoryPostProvider(syntheticPosts);

    await expect(
      provider.updateDraft("fixture-002", "4", { title: "Must remain published" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(provider.get("fixture-002")).resolves.toMatchObject({
      title: "Fabricated published sample",
      status: "published",
      version: "4",
    });
  });
});
