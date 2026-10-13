import type {
  PostDocument,
  PostDraftInput,
  PostPage,
  PostPatch,
  PostQuery,
  PostStatus,
} from "../domain/post.js";

export type PostProviderCapabilities = {
  readonly listStatuses: readonly PostStatus[];
  readonly supportsDraftCreation: true;
  readonly supportsDraftOnlyUpdates: true;
  readonly supportsAtomicDraftUpdates: true;
};

export interface PostProvider {
  /** Declares supported list statuses and the required safe-write guarantees. */
  readonly capabilities: PostProviderCapabilities;
  list(query: PostQuery): Promise<PostPage>;
  get(id: string): Promise<PostDocument>;
  createDraft(input: PostDraftInput): Promise<PostDocument>;
  /** Implementations must atomically reject non-drafts and stale expectedVersion values. */
  updateDraft(id: string, expectedVersion: string, patch: PostPatch): Promise<PostDocument>;
}
