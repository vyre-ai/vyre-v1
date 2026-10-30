// One public MCP document becomes drafted actions.
// The document text stays inside this call. It is not returned. A description is not an action, and a URL inside the document is not opened.
import { lookup } from "node:dns/promises";
import { documentNetwork } from "../document-network.ts";
import { mcpActionsFromUrl } from "../mcp-source.ts";
import type { FetchDeps } from "../public-fetch.ts";
import type { AutoCtx } from "../projections.ts";

async function lookupHost(host: string): Promise<string[]> {
  const rows = await lookup(host, { all: true, verbatim: true });
  return rows.map((row) => row.address);
}

export async function openMcpWith(app: string, url: string, deps: FetchDeps): Promise<unknown> {
  const result = await mcpActionsFromUrl(app, url, deps);
  if (!result.ok) return { ok: false, reason: result.reason };
  return { ok: true, actions: result.actions };
}

export async function openMcp(_ctx: AutoCtx, input: { app?: unknown; url?: unknown }): Promise<unknown> {
  const app = typeof input.app === "string" ? input.app : "";
  const url = typeof input.url === "string" ? input.url : "";
  const installed = documentNetwork();
  return openMcpWith(app, url, installed ?? { fetch: globalThis.fetch, lookup: lookupHost });
}
