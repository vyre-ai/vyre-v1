// An agent reads one public API docs page, read only: https, a public host, a GET with no key and no cookies. It returns the page as plain text (or one line per operation for an OpenAPI document),
// the links on the same host, and nothing else. The text is data, not instructions; the skill tells the agent so. A private, loopback or metadata address is refused by the shared fetcher.
import { lookup } from "node:dns/promises";
import { docsView } from "../docs-text.ts";
import { documentNetwork } from "../document-network.ts";
import { fetchPublicDocument } from "../public-fetch.ts";
import type { AutoCtx } from "../projections.ts";

type In = { url?: unknown; focus?: unknown };

async function lookupHost(host: string): Promise<string[]> {
  const rows = await lookup(host, { all: true, verbatim: true });
  return rows.map((row) => row.address);
}

export async function readDocs(_ctx: AutoCtx, input: In): Promise<unknown> {
  const url = typeof input.url === "string" ? input.url : "";
  const fetched = await fetchPublicDocument(url, documentNetwork() ?? { fetch: globalThis.fetch, lookup: lookupHost });
  if (!fetched.ok) return { ok: false, reason: fetched.reason };
  const view = docsView(fetched.text, new URL(fetched.finalUrl), typeof input.focus === "string" ? input.focus : undefined);
  return { ok: true, finalUrl: fetched.finalUrl, kind: view.kind, text: view.text, links: view.links, truncated: view.truncated };
}
