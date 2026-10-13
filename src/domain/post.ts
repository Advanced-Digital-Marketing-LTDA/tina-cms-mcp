export type PostStatus = "draft" | "published" | "archived";

export type PostDocument = {
  id: string;
  version: string;
  title: string;
  slug: string;
  bodyMarkdown: string;
  summary?: string;
  tags?: string[];
  status: PostStatus;
  createdAt?: string;
  updatedAt?: string;
};

export type PostSummary = Pick<
  PostDocument,
  "id" | "version" | "title" | "slug" | "summary" | "tags" | "status" | "createdAt" | "updatedAt"
>;

export type PostDraftInput = {
  title: string;
  slug: string;
  bodyMarkdown: string;
  summary?: string;
  tags?: string[];
};

export type PostPatch = Partial<PostDraftInput>;
export type PostQuery = { status?: PostStatus; limit: number; cursor?: string };
export type PostPage = { items: PostSummary[]; nextCursor: string | null };
