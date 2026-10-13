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

  it("does not expose stored tags through a listed summary", async () => {
    const provider = new InMemoryPostProvider(syntheticPosts);

    const page = await provider.list({ limit: 1 });
    page.items[0]!.tags?.push("mutated-by-caller");

    await expect(provider.get("fixture-001")).resolves.not.toMatchObject({ tags: expect.arrayContaining(["mutated-by-caller"]) });
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

  it("does not reuse an identifier already present in seeded data", async () => {
    const seeded = [{ ...syntheticPosts[0]!, id: "synthetic-1" }];
    const provider = new InMemoryPostProvider(seeded);

    const created = await provider.createDraft({
      title: "Synthetic created post",
      slug: "synthetic-created-post",
      bodyMarkdown: "Created only for a unit test.",
    });

    expect(created.id).not.toBe("synthetic-1");
    await expect(provider.get("synthetic-1")).resolves.toMatchObject({ title: seeded[0]!.title });
    await expect(provider.get(created.id)).resolves.toMatchObject({ title: "Synthetic created post" });
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

  it("advances nonnumeric opaque versions so stale-write protection remains effective", async () => {
    const seed = [{ ...syntheticPosts[0]!, version: "opaque-token" }];
    const provider = new InMemoryPostProvider(seed);

    const first = await provider.updateDraft(seed[0]!.id, "opaque-token", { title: "First update" });
    const second = await provider.updateDraft(seed[0]!.id, first.version, { title: "Second update" });

    expect(first.version).not.toBe("NaN");
    expect(second.version).not.toBe(first.version);
    await expect(provider.updateDraft(seed[0]!.id, first.version, { title: "Stale update" })).rejects.toMatchObject({ code: "CONFLICT" });
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
