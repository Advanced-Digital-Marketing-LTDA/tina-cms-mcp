import type { PostDocument } from "../../src/domain/post.js";

export const syntheticPosts: PostDocument[] = [
  {
    id: "fixture-001",
    version: "1",
    title: "Fabricated draft one",
    slug: "fabricated-draft-one",
    bodyMarkdown: "Synthetic fixture body. No live content.",
    summary: "Synthetic summary one",
    tags: ["fixture", "draft"],
    status: "draft",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
  },
  {
    id: "fixture-002",
    version: "4",
    title: "Fabricated published sample",
    slug: "fabricated-published-sample",
    bodyMarkdown: "Published synthetic fixture body.",
    status: "published",
    createdAt: "2025-02-01T00:00:00.000Z",
    updatedAt: "2025-02-02T00:00:00.000Z",
  },
  {
    id: "fixture-003",
    version: "2",
    title: "Fabricated draft two",
    slug: "fabricated-draft-two",
    bodyMarkdown: "Another synthetic fixture body.",
    status: "draft",
    createdAt: "2025-03-01T00:00:00.000Z",
    updatedAt: "2025-03-01T00:00:00.000Z",
  },
];
