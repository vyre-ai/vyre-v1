// A document already in memory becomes a draft. A named app can load one allowlisted official document.
// A docs URL the person supplied is stored, not fetched. No row is written and nothing is promoted.
import { draftKnown } from "../docs.ts";
import { generate } from "../generate.ts";
import type { OpenApiDocument } from "../generate.ts";
import { raise } from "../projections.ts";
import type { AutoCtx } from "../projections.ts";
import { setupFrom } from "../setup.ts";

type In = { document?: unknown; docsUrl?: unknown; app?: unknown; intent?: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function documentOf(value: unknown): OpenApiDocument {
  if (isRecord(value)) return value as OpenApiDocument;
  return {};
}

function pasted(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return value.openapi !== undefined || value.paths !== undefined || value.webhooks !== undefined;
}

export async function draftConnector(ctx: AutoCtx, input: In): Promise<unknown> {
  const docsUrl = typeof input.docsUrl === "string" ? input.docsUrl : undefined;
  let document = documentOf(input.document);
  let stored = docsUrl;
  if (!pasted(input.document) && typeof input.app === "string" && input.app.trim()) {
    const loaded = await draftKnown(input.app, typeof input.intent === "string" ? input.intent : "", globalThis.fetch);
    if (!loaded.ok) raise(ctx, "validation.bad_input", loaded.reason);
    document = documentOf(loaded.document);
    stored = loaded.docsUrl;
  }
  const result = generate(document, stored === undefined ? undefined : { docsUrl: stored });
  if (!result.ok) raise(ctx, "validation.bad_input", result.reason);
  const setup = setupFrom(document, result.actions, stored);
  return { draft: result.draft, actions: result.actions, request: result.request, refused: result.refused, setup };
}
