// A document already in memory becomes a draft. A named app loads one allowlisted official document.
// A docs URL is fetched only when neither of those is present. The page is data, not a prompt.
// Its text is not returned. No row is written and nothing is promoted.
import { lookup } from "node:dns/promises";
import { documentNetwork } from "../document-network.ts";
import { draftKnown } from "../docs.ts";
import { generate } from "../generate.ts";
import type { OpenApiDocument } from "../generate.ts";
import { fetchPublicDocument } from "../public-fetch.ts";
import { raise } from "../projections.ts";
import type { AutoCtx } from "../projections.ts";
import { setupFrom } from "../setup.ts";
import { containsSecret } from "../trust.ts";

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

async function lookupHost(host: string): Promise<string[]> {
  const rows = await lookup(host, { all: true, verbatim: true });
  return rows.map((row) => row.address);
}

function cleanDocsUrl(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed || containsSecret(trimmed)) return undefined;
  return trimmed;
}

function pageDocument(text: string): OpenApiDocument | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!pasted(parsed)) return undefined;
  return documentOf(parsed);
}

function emptyDraft(docsUrl: string): unknown {
  const stored = cleanDocsUrl(docsUrl);
  return {
    draft: {
      key: "api",
      level: "draft",
      tested: false,
      reviewed: false,
      auth: "unknown",
      ...(stored ? { docsUrl: stored } : {}),
    },
    actions: [],
    request: null,
    refused: [],
    setup: setupFrom({}, [], stored),
  };
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
  } else if (!pasted(input.document) && typeof input.app !== "string" && docsUrl !== undefined) {
    const installed = documentNetwork();
    const fetched = await fetchPublicDocument(docsUrl, installed ?? { fetch: globalThis.fetch, lookup: lookupHost });
    if (!fetched.ok) raise(ctx, "validation.bad_input", fetched.reason);
    const page = pageDocument(fetched.text);
    if (!page) return emptyDraft(docsUrl);
    document = page;
  }
  const result = generate(document, stored === undefined ? undefined : { docsUrl: stored });
  if (!result.ok) raise(ctx, "validation.bad_input", result.reason);
  const setup = setupFrom(document, result.actions, stored);
  return { draft: result.draft, actions: result.actions, request: result.request, refused: result.refused, setup };
}
