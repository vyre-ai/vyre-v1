// The binary transfers shared by the Google and Microsoft seams: a Drive upload can replace a file in place (PATCH), a Graph upload can be conditional (If-Match), and a 412 means the item moved on.
import test from "node:test";
import assert from "node:assert/strict";
import { putFile, uploadFile } from "./transfer.ts";
import type { SeamFetch } from "./ports.ts";

const ctx = { space: "spc_t", trace: { traceId: "0123456789abcdef0123456789abcdef" }, now: () => 0, db: { all: () => [] } };
const files = { read: async () => ({ name: "a.txt", mime: "text/plain", bytes: new TextEncoder().encode("hello") }) };

function fetcher(status: number): { fetch: SeamFetch; seen: { url: string; method?: string; headers?: Record<string, string> }[] } {
  const seen: { url: string; method?: string; headers?: Record<string, string> }[] = [];
  const fetch: SeamFetch = async (url, init) => {
    seen.push({ url, ...(init?.method !== undefined ? { method: init.method } : {}), ...(init?.headers !== undefined ? { headers: init.headers } : {}) });
    return { status, text: async () => "{}", arrayBuffer: async () => new ArrayBuffer(0) };
  };
  return { fetch, seen };
}

test("a Drive upload is a POST by default and a PATCH when it replaces a file in place", async () => {
  const f = fetcher(200);
  const d = { fetch: f.fetch, files, domains: ["googleapis.com"] };
  await uploadFile(ctx, d, { url: "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", token: "t", fileId: "fil_1", metadata: { name: "a" } });
  await uploadFile(ctx, d, { url: "https://www.googleapis.com/upload/drive/v3/files/f1?uploadType=multipart", token: "t", fileId: "fil_1", metadata: {}, method: "PATCH" });
  assert.deepEqual(f.seen.map((s) => s.method), ["POST", "PATCH"]);
});

test("a Graph upload sends If-Match only when asked, and a 412 is a version conflict", async () => {
  const ok = fetcher(200);
  const d = { fetch: ok.fetch, files, domains: ["graph.microsoft.com"] };
  await putFile(ctx, d, { url: "https://graph.microsoft.com/v1.0/me/drive/items/i1/content", token: "t", fileId: "fil_1" });
  await putFile(ctx, d, { url: "https://graph.microsoft.com/v1.0/me/drive/items/i1/content", token: "t", fileId: "fil_1", ifMatch: "etag1" });
  assert.deepEqual(ok.seen.map((s) => s.headers?.["if-match"]), [undefined, "etag1"]);

  const stale = fetcher(412);
  await assert.rejects(
    () => putFile(ctx, { fetch: stale.fetch, files, domains: ["graph.microsoft.com"] }, { url: "https://graph.microsoft.com/v1.0/me/drive/items/i1/content", token: "t", fileId: "fil_1", ifMatch: "old" }),
    (e) => (e as { error?: { code?: string } }).error?.code === "validation.version_conflict",
  );
});
