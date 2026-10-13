export type PostErrorCode = "NOT_FOUND" | "CONFLICT" | "BACKEND_UNAVAILABLE";
export type ToolErrorCode =
  | PostErrorCode
  | "VALIDATION"
  | "BACKEND_NOT_CONFIGURED"
  | "FORBIDDEN";

export class PostError extends Error {
  constructor(readonly code: PostErrorCode, message: string) {
    super(message);
    this.name = "PostError";
  }
}

export class ToolError extends Error {
  constructor(readonly code: ToolErrorCode, message: string) {
    super(message);
    this.name = "ToolError";
  }
}
