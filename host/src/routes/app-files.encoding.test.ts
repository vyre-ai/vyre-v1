// The Space's own app is sent compressed and cached the way a fast first visit needs (r38: the 8.7 MB entry went out as it was, 3.3 s to the page on a 24 Mbps link): brotli or gzip when the browser accepts it, the export's own
// .br and .gz copies when it has them, a hashed file cached for good, the page checked each time and answered 304 when unchanged.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { acceptedEncoding, createAppFilesRoute } from "./app-files.ts";

const BIG = `${"function sign_in(){return document.querySelector('input')}\n".repeat(4000)}`;

function exportDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-app-enc-"));
  fs.writeFileSync(path.join(dir, "index.html"), `<!doctype html><title>app</title>${"<!-- x -->".repeat(200)}`);
  fs.mkdirSync(path.join(dir, "_expo/static/js/web"), { recursive: true });
  fs.writeFileSync(path.join(dir, "_expo/static/js/web/entry-abc123.js"), BIG);
  fs.writeFileSync(path.join(dir, "tiny.js"), "1");
  fs.writeFileSync(path.join(dir, "pic.png"), Buffer.alloc(5000, 7));
  return dir;
}

async function serve(dir: string): Promise<{ origin: string; close(): Promise<void> }> {
  const route = createAppFilesRoute({ dir: () => dir });
  const server = http.createServer((req, res) => {
    if (!route.handle(req, res)) {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    origin: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

/** The bytes as sent, with no decoding (fetch would unpack them). */
function raw(
  origin: string,
  p: string,
  headers: Record<string, string>,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    http
      .get(`${origin}${p}`, { headers, agent: false }, (res) => {
        const parts: Buffer[] = [];
        res.on("data", (c: Buffer) => parts.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(parts) }));
      })
      .on("error", reject);
  });
}
const JS = "/_expo/static/js/web/entry-abc123.js";

test("the browser's Accept-Encoding is read: brotli over gzip, a refused one never used", () => {
  assert.equal(acceptedEncoding("gzip, deflate, br, zstd"), "br");
  assert.equal(acceptedEncoding("gzip, deflate"), "gzip");
  assert.equal(acceptedEncoding("br;q=0, gzip"), "gzip");
  assert.equal(acceptedEncoding("gzip;q=0"), null);
  assert.equal(acceptedEncoding("*"), "br");
  assert.equal(acceptedEncoding(undefined), null);
  assert.equal(acceptedEncoding("identity"), null);
});

test("a text file is sent in brotli or gzip with Vary, a length, and the cache header it had; the bytes unpack to the file", async () => {
  const s = await serve(exportDir());
  try {
    const br = await raw(s.origin, JS, { "accept-encoding": "gzip, deflate, br" });
    assert.equal(br.status, 200);
    assert.equal(br.headers["content-encoding"], "br");
    assert.match(String(br.headers["vary"]), /Accept-Encoding/i);
    assert.equal(br.headers["content-length"], String(br.body.length));
    assert.match(
      String(br.headers["cache-control"]),
      /max-age=31536000, immutable/,
      "a hashed file is cached for a year",
    );
    assert.ok(br.body.length < BIG.length / 10, `brotli sent ${br.body.length} of ${BIG.length}`);
    assert.equal(zlib.brotliDecompressSync(br.body).toString(), BIG);
    const gz = await raw(s.origin, JS, { "accept-encoding": "gzip" });
    assert.equal(gz.headers["content-encoding"], "gzip");
    assert.equal(zlib.gunzipSync(gz.body).toString(), BIG);
    const plain = await raw(s.origin, JS, {});
    assert.equal(plain.headers["content-encoding"], undefined);
    assert.equal(plain.body.toString(), BIG, "a client that accepts nothing gets the file as it is");
    const page = await raw(s.origin, "/", { accept: "text/html", "accept-encoding": "br" });
    assert.equal(page.headers["content-encoding"], "br", "the page is compressed too");
    assert.equal(page.headers["cache-control"], "no-cache", "and asked about on every visit");
  } finally {
    await s.close();
  }
});

test("a picture and a tiny file are sent as they are", async () => {
  const s = await serve(exportDir());
  try {
    const png = await raw(s.origin, "/pic.png", { "accept-encoding": "br, gzip" });
    assert.equal(png.headers["content-encoding"], undefined);
    assert.equal(png.body.length, 5000);
    const tiny = await raw(s.origin, "/tiny.js", { "accept-encoding": "br, gzip" });
    assert.equal(tiny.headers["content-encoding"], undefined);
  } finally {
    await s.close();
  }
});

test("the export's own .br and .gz copies are what is sent when they exist, and an unchanged page answers 304", async () => {
  const dir = exportDir();
  // what scripts/app-export.mjs writes beside each text file (scripts/lib/precompress.mjs): a .br and a .gz
  const entry = path.join(dir, "_expo/static/js/web/entry-abc123.js");
  fs.writeFileSync(`${entry}.br`, zlib.brotliCompressSync(Buffer.from(BIG)));
  fs.writeFileSync(`${entry}.gz`, zlib.gzipSync(Buffer.from(BIG)));
  const s = await serve(dir);
  try {
    const br = await raw(s.origin, JS, { "accept-encoding": "br" });
    assert.deepEqual(br.body, fs.readFileSync(`${entry}.br`), "the export's own bytes, not made again");
    assert.equal((await raw(s.origin, JS, { "accept-encoding": "gzip" })).body.length, fs.statSync(`${entry}.gz`).size);
    assert.equal(zlib.brotliDecompressSync(br.body).toString(), BIG);
    const first = await raw(s.origin, "/", { accept: "text/html", "accept-encoding": "br" });
    const etag = String(first.headers["etag"]);
    assert.ok(etag.length > 3);
    const again = await raw(s.origin, "/", { accept: "text/html", "accept-encoding": "br", "if-none-match": etag });
    assert.equal(again.status, 304);
    assert.equal(again.body.length, 0);
  } finally {
    await s.close();
  }
});
