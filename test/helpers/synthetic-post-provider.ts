import { PostError } from "../../src/domain/errors.js";
import type {
  PostDocument,
  PostDraftInput,
  PostPage,
  PostPatch,
  PostQuery,
  PostSummary,
} from "../../src/domain/post.js";
import type { PostProvider } from "../../src/providers/post-provider.js";

function clonePost(post: PostDocument): PostDocument {
  return structuredClone(post);
}

function summarize(post: PostDocument): PostSummary {
  const { bodyMarkdown: _bodyMarkdown, ...summary } = post;
  return structuredClone(summary);
}

function nextVersion(version: string): string {
  const numeric = Number(version);
  return Number.isSafeInteger(numeric) && String(numeric) === version
    ? String(numeric + 1)
    : `${version}:next`;
}

function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const parsed = Number(Buffer.from(cursor, "base64url").toString("utf8"));
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new PostError("CONFLICT", "Invalid synthetic cursor");
  }
  return parsed;
}

export class InMemoryPostProvider implements PostProvider {
  readonly capabilities = {
    listStatuses: ["draft", "published", "archived"],
    supportsDraftCreation: true,
    supportsDraftOnlyUpdates: true,
    supportsAtomicDraftUpdates: true,
  } as const;
  private readonly posts: PostDocument[];
  private nextId = 1;

  constructor(posts: readonly PostDocument[] = []) {
    this.posts = posts.map(clonePost);
  }

  async list(query: PostQuery): Promise<PostPage> {
    const filtered = query.status
      ? this.posts.filter((post) => post.status === query.status)
      : this.posts;
    const offset = decodeCursor(query.cursor);
    const page = filtered.slice(offset, offset + query.limit);
    const nextOffset = offset + page.length;

    return {
      items: page.map(summarize),
      nextCursor: nextOffset < filtered.length ? encodeCursor(nextOffset) : null,
    };
  }

  async get(id: string): Promise<PostDocument> {
    const post = this.posts.find((item) => item.id === id);
    if (!post) throw new PostError("NOT_FOUND", "Post not found");
    return clonePost(post);
  }

  async createDraft(input: PostDraftInput): Promise<PostDocument> {
    if (this.posts.some((post) => post.slug === input.slug)) {
      throw new PostError("CONFLICT", "Slug already exists");
    }

    const now = new Date().toISOString();
    let id: string;
    do {
      id = `synthetic-${this.nextId++}`;
    } while (this.posts.some((post) => post.id === id));
    const created: PostDocument = {
      ...structuredClone(input),
      id,
      version: "1",
      status: "draft",
      createdAt: now,
      updatedAt: now,
    };
    this.posts.push(created);
    return clonePost(created);
  }

  async updateDraft(
    id: string,
    expectedVersion: string,
    patch: PostPatch,
  ): Promise<PostDocument> {
    const index = this.posts.findIndex((item) => item.id === id);
    if (index === -1) throw new PostError("NOT_FOUND", "Post not found");

    const current = this.posts[index]!;
    if (current.status !== "draft") {
      throw new PostError("CONFLICT", "Only drafts can be updated");
    }
    if (current.version !== expectedVersion) {
      throw new PostError("CONFLICT", "Post version is stale");
    }
    if (patch.slug && this.posts.some((post) => post.id !== id && post.slug === patch.slug)) {
      throw new PostError("CONFLICT", "Slug already exists");
    }

    const updated: PostDocument = {
      ...current,
      ...structuredClone(patch),
      version: nextVersion(current.version),
      updatedAt: new Date().toISOString(),
    };
    this.posts[index] = updated;
    return clonePost(updated);
  }
}
