// A site or artifact served from a folder whose file lives at its provider (a Drive folder): when the provider cannot be reached the page is "temporarily unavailable" (503 with a retry hint),
// never "not found", which says the page does not exist and may be cached or shown as removed.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { serve } from "../src/routes/public-path.ts";
import type { PublicPathDeps } from "../src/routes/public-path.ts";

async function run(file: PublicPathDeps["file"]): Promise<{ status: number; retry: string | null; body: string }> {
  const server = http.createServer((req, res) => {
    void serve(
      { forms: () => null, origin: () => null, ...(file ? { file } : {}) },
      { siteId: "sit_1", access: "public", live: true, blocked: false, target: { folderId: "fld_1" } },
      "/index.html",
      "/index.html",
      "/p/walk",
      req,
      res,
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/p/walk/`);
    return { status: res.status, retry: res.headers.get("retry-after"), body: await res.text() };
  } finally {
    server.close();
  }
}

test("a provider that is down is 503 with a retry hint; a file that is not there is 404; a file that is there is 200", async () => {
  const down = await run(async () => {
    throw Object.assign(new Error("down"), { error: { code: "provider.unavailable" } });
  });
  assert.equal(down.status, 503);
  assert.equal(down.retry, "30");
  assert.match(down.body, /Try again in a minute/);
  assert.equal((await run(async () => null)).status, 404);
  assert.equal((await run(async () => ({ bytes: new TextEncoder().encode("hi"), mime: "text/html" }))).status, 200);
});
