import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { VerifiedPrincipal } from "../auth/principal.js";
import { PostError, ToolError, type ToolErrorCode } from "../domain/errors.js";
import type { PostDraftInput, PostPatch, PostStatus } from "../domain/post.js";
import type { PostProvider } from "../providers/post-provider.js";
import { ProviderRegistry } from "../providers/provider-registry.js";

const statusSchema = z.enum(["draft", "published", "archived"]);
const titleSchema = z.string().trim().min(1).max(160);
const slugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase words separated by hyphens");
const bodySchema = z.string().max(100_000);
const summarySchema = z.string().max(300).optional();
const tagsSchema = z.array(z.string().max(40)).max(20).optional();

const listInput = z
  .object({
    status: statusSchema.optional(),
    limit: z.number().int().min(1).max(100).default(20),
    cursor: z.string().min(1).max(512).optional(),
  })
  .strict();
const getInput = z.object({ id: z.string().min(1).max(160) }).strict();
const createInput = z
  .object({
    title: titleSchema,
    slug: slugSchema,
    bodyMarkdown: bodySchema,
    summary: summarySchema,
    tags: tagsSchema,
  })
  .strict();
const patchFields = {
  title: titleSchema.optional(),
  slug: slugSchema.optional(),
  bodyMarkdown: bodySchema.optional(),
  summary: summarySchema,
  tags: tagsSchema,
};
const updateInput = z
  .object({
    id: z.string().min(1).max(160),
    expectedVersion: z.string().min(1).max(128),
    patch: z.object(patchFields).strict().refine((patch) => Object.keys(patch).length > 0, {
      message: "At least one editable field is required",
    }),
  })
  .strict();

// These schemas publish supported constraints to MCP clients. The tool schemas
// pass unknown top-level keys through to handlers; update_post validates its
// nested patch at the MCP boundary, so patch schema errors are unstructured.
const listToolSchema = z
  .object({
    status: statusSchema.optional(),
    limit: z.number().int().min(1).max(100).optional(),
    cursor: z.string().min(1).max(512).optional(),
  })
  .passthrough();
const getToolSchema = z.object({ id: z.string() }).passthrough();
const createToolSchema = z
  .object({
    title: z.string(),
    slug: z.string(),
    bodyMarkdown: z.string(),
    summary: z.string().optional(),
    tags: z.array(z.string()).optional(),
  })
  .passthrough();
const updateToolSchema = z
  .object({
    id: z.string().min(1).max(160),
    expectedVersion: z.string().min(1).max(128).describe("Required concurrency version from a previous read"),
    patch: z.object(patchFields).strict(),
  })
  .passthrough();

function validationMessage(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.length ? `${issue.path.join(".")}: ` : ""}${issue.message}`)
    .join("; ");
}

function errorResult(code: ToolErrorCode, message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: `${code}: ${message}` }],
    structuredContent: { code, message },
  };
}

function errorFor(error: unknown): CallToolResult {
  if (error instanceof ToolError) {
    return errorResult(error.code, error.message);
  }
  if (error instanceof PostError) {
    const safeMessages: Record<PostError["code"], string> = {
      NOT_FOUND: "Post not found",
      CONFLICT: "The post could not be changed because of a conflict",
      BACKEND_UNAVAILABLE: "The content provider is unavailable",
    };
    return errorResult(error.code, safeMessages[error.code]);
  }
  return errorResult("BACKEND_UNAVAILABLE", "The content provider is unavailable");
}

function hasScope(principal: VerifiedPrincipal, scope: string): boolean {
  return principal.scopes.has(scope);
}

async function execute<T, R>(options: {
  input: unknown;
  schema: z.ZodType<T>;
  scope: string;
  principal: VerifiedPrincipal;
  registry: ProviderRegistry;
  action: (provider: PostProvider, args: T) => Promise<R>;
}): Promise<CallToolResult> {
  const parsed = options.schema.safeParse(options.input);
  if (!parsed.success) return errorResult("VALIDATION", validationMessage(parsed.error));
  if (!hasScope(options.principal, options.scope)) {
    return errorResult("FORBIDDEN", "The access token lacks the required post scope");
  }

  const provider = options.registry.get();
  if (!provider) {
    return errorResult("BACKEND_NOT_CONFIGURED", "No content provider is configured");
  }

  try {
    const result = await options.action(provider, parsed.data);
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
    };
  } catch (error) {
    return errorFor(error);
  }
}

function postDraftInput(value: z.output<typeof createInput>): PostDraftInput {
  return {
    title: value.title,
    slug: value.slug,
    bodyMarkdown: value.bodyMarkdown,
    ...(value.summary !== undefined ? { summary: value.summary } : {}),
    ...(value.tags !== undefined ? { tags: value.tags } : {}),
  };
}

export function registerPostTools(
  server: McpServer,
  registry: ProviderRegistry,
  principal: VerifiedPrincipal,
): void {
  server.registerTool(
    "list_posts",
    {
      description: "List post summaries with optional status filter and bounded pagination.",
      inputSchema: listToolSchema,
    },
    async (input) =>
      execute({
        input,
        schema: listInput,
        scope: "posts:read",
        principal,
        registry,
        action: (provider, args) =>
          provider.list({
            limit: args.limit,
            ...(args.status ? { status: args.status as PostStatus } : {}),
            ...(args.cursor ? { cursor: args.cursor } : {}),
          }),
      }),
  );

  server.registerTool(
    "get_post",
    {
      description: "Fetch one post by its stable provider identifier.",
      inputSchema: getToolSchema,
    },
    async (input) =>
      execute({
        input,
        schema: getInput,
        scope: "posts:read",
        principal,
        registry,
        action: (provider, args) => provider.get(args.id),
      }),
  );

  server.registerTool(
    "create_post",
    {
      description: "Create a draft post. This tool never publishes content.",
      inputSchema: createToolSchema,
    },
    async (input) =>
      execute({
        input,
        schema: createInput,
        scope: "posts:write",
        principal,
        registry,
        action: (provider, args) => provider.createDraft(postDraftInput(args)),
      }),
  );

  server.registerTool(
    "update_post",
    {
      description: "Update draft fields by ID and expected version. Publication fields cannot be changed.",
      inputSchema: updateToolSchema,
    },
    async (input) =>
      execute({
        input,
        schema: updateInput,
        scope: "posts:write",
        principal,
        registry,
        action: (provider, args) =>
          provider.updateDraft(args.id, args.expectedVersion, args.patch as PostPatch),
      }),
  );
}
