import type {
  PostDocument,
  PostDraftInput,
  PostPage,
  PostPatch,
  PostQuery,
} from "../domain/post.js";

export interface PostProvider {
  list(query: PostQuery): Promise<PostPage>;
  get(id: string): Promise<PostDocument>;
  createDraft(input: PostDraftInput): Promise<PostDocument>;
  updateDraft(id: string, expectedVersion: string, patch: PostPatch): Promise<PostDocument>;
}
