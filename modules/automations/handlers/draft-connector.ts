// An OpenAPI document already in memory becomes a draft. docsUrl is stored, not fetched. No row is written and nothing is promoted.
import { generate } from "../generate.ts";
import type { OpenApiDocument } from "../generate.ts";
import { raise } from "../projections.ts";
import type { AutoCtx } from "../projections.ts";

type In = { document?: unknown; docsUrl?: unknown };

function documentOf(value: unknown): OpenApiDocument {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) return value as OpenApiDocument;
  return {};
}

export async function draftConnector(ctx: AutoCtx, input: In): Promise<unknown> {
  const docsUrl = typeof input.docsUrl === "string" ? input.docsUrl : undefined;
  const result = generate(documentOf(input.document), docsUrl === undefined ? undefined : { docsUrl });
  if (!result.ok) raise(ctx, "validation.bad_input", result.reason);
  return { draft: result.draft, actions: result.actions, request: result.request, refused: result.refused };
}
