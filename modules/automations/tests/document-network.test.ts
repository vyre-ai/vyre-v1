// The installed fetch answers the redirects. After it is cleared, openDocument does not call it.
import test from "node:test";
import assert from "node:assert/strict";
import { documentNetwork, setDocumentNetwork } from "../document-network.ts";
import { openDocument } from "../handlers/open-document.ts";
import type { AutoCtx } from "../projections.ts";
import type { FetchDeps } from "../public-fetch.ts";

const NOT_PUBLIC = "That address is not a public host.";
const START = "https://docs.example/spec";
const ctx = {} as AutoCtx;

function redirectDeps(location: string, seen: string[]): FetchDeps {
  return {
    lookup: async (host) => {
      assert.equal(host, "docs.example");
      return ["93.184.216.34"];
    },
    fetch: (async (url: unknown) => {
      seen.push(String(url));
      return new Response(null, { status: 302, headers: { location } });
    }) as typeof fetch,
  };
}

test("a redirect to https://127.0.0.1/latest is refused and a later call does not use that fetch", async () => {
  const seen: string[] = [];
  setDocumentNetwork(redirectDeps("https://127.0.0.1/latest", seen));
  try {
    const out = await openDocument(ctx, { url: START });
    assert.deepEqual(out, { ok: false, reason: NOT_PUBLIC });
    assert.deepEqual(seen, [START]);
    setDocumentNetwork(null);
    assert.equal(documentNetwork(), null);
    const later: string[] = [];
    setDocumentNetwork(redirectDeps("https://10.0.0.8/secret", later));
    const again = await openDocument(ctx, { url: START });
    assert.deepEqual(again, { ok: false, reason: NOT_PUBLIC });
    assert.deepEqual(seen, [START]);
    assert.deepEqual(later, [START]);
  } finally {
    setDocumentNetwork(null);
  }
});

test("a redirect to https://10.1.2.3/v1 is refused", async () => {
  const seen: string[] = [];
  setDocumentNetwork(redirectDeps("https://10.1.2.3/v1", seen));
  try {
    const out = await openDocument(ctx, { url: START });
    assert.deepEqual(out, { ok: false, reason: NOT_PUBLIC });
    assert.deepEqual(seen, [START]);
  } finally {
    setDocumentNetwork(null);
  }
});

test("a redirect to https://169.254.169.254/latest/meta-data is refused", async () => {
  const seen: string[] = [];
  setDocumentNetwork(redirectDeps("https://169.254.169.254/latest/meta-data", seen));
  try {
    const out = await openDocument(ctx, { url: START });
    assert.deepEqual(out, { ok: false, reason: NOT_PUBLIC });
    assert.deepEqual(seen, [START]);
  } finally {
    setDocumentNetwork(null);
  }
});
