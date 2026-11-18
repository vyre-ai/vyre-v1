// What a visit will load next is told in the page (app-hints.ts, r39): the lists of chunk files the export's own scripts hold are read, put in the page, and a visit with a session preloads them while one without prefetches them.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { PLACE_CHUNKS, hintsFor, injectHints, listsIn } from "./app-hints.ts";
import { createAppFilesRoute } from "./app-files.ts";

const H = "0123456789abcdef0123456789abcdef";
const u = (name: string, h = H): string => `/_expo/static/js/web/${name}-${h}.js`;
const sh = (n: number): string => `/_expo/static/js/web/__shared-${String(n).padStart(16, "0")}-${H}.js`;
const list = (...urls: string[]): string => urls.map((x) => JSON.stringify(x)).join(",");

function exportDir(withLists = true): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-hints-"));
  const web = path.join(dir, "_expo/static/js/web");
  fs.mkdirSync(web, { recursive: true });
  fs.writeFileSync(path.join(web, `__expo-metro-runtime-${H}.js`), "runtime();");
  const entry = withLists
    ? `a=_r(d[1])(d[2],{"7":[${list(u("ShellHost"), sh(1), sh(2))}]});b=lazy(()=>_r(d[3])(d[4],{"9":[${list(u("chats"), sh(2), sh(3))}]}));c=[${list(u("records"), sh(4))}]`
    : "nothing();";
  fs.writeFileSync(path.join(web, `index-${H}.js`), entry);
  // the shell's own code asks for the route table and the screens
  fs.writeFileSync(path.join(web, `ShellHost-${H}.js`), `r=[${list(u("routes"), sh(5))}];s=[${list(u("screens"))}]`);
  // the Chats place's own file names a page it opens on request
  fs.writeFileSync(path.join(web, `chats-${H}.js`), `p=[${list(u("TaskDetail"), sh(3), sh(6))}]`);
  fs.writeFileSync(
    path.join(dir, "index.html"),
    `<!DOCTYPE html><html><head><meta charSet="utf-8"/><script defer="" src="/_expo/static/js/web/__expo-metro-runtime-${H}.js"></script><script defer="" src="/_expo/static/js/web/index-${H}.js"></script></head><body></body></html>`,
  );
  return dir;
}

test("the lists of files a chunk needs are read from its code, by the name of the chunk that heads each", () => {
  const got = listsIn(`x=[${list(u("ShellHost"), sh(1))}];y=[${list(u("chats"), sh(2), sh(3))}]`);
  assert.deepEqual(got.get("ShellHost"), [u("ShellHost"), sh(1)]);
  assert.deepEqual(got.get("chats"), [u("chats"), sh(2), sh(3)]);
  assert.equal(listsIn("no lists here").size, 0);
});

test("the shell, the route table and each place's files are found, following the shell's own code one step", () => {
  const dir = exportDir();
  const h = hintsFor(dir, [`/_expo/static/js/web/index-${H}.js`])!;
  assert.deepEqual(h.shell, [u("ShellHost"), sh(1), sh(2), u("routes"), sh(5), u("screens")]);
  assert.deepEqual(h.places["chat"], [u("chats"), sh(2), sh(3)]);
  assert.deepEqual(h.places["records"], [u("records"), sh(4)]);
  assert.equal(h.places["vault"], undefined, "a place with no list gets none");
  assert.deepEqual(
    h.idle,
    [u("TaskDetail"), sh(6)],
    "the pages a place opens later, less what is already in the lists",
  );
  assert.ok(Object.values(PLACE_CHUNKS).includes("chats"));
});

test("a page gets its hints and the script that uses them; a page whose scripts hold no lists is sent as it is", () => {
  const dir = exportDir();
  const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
  const out = injectHints(html, dir);
  assert.match(out, /<script id="vyre-hints" type="application\/json">.*<\/head>/s);
  assert.match(out, /vyre\.session\.v1/);
  assert.match(out, /"preload"/);
  assert.match(out, /"prefetch"/);
  const json = JSON.parse(/id="vyre-hints" type="application\/json">(.*?)<\/script>/.exec(out)![1]!) as {
    shell: string[];
    places: Record<string, string[]>;
  };
  assert.equal(json.shell.length, 6);
  assert.match(out, /prefetch/);
  assert.equal(injectHints(html, exportDir(false)), html, "no lists, no change");
  assert.equal(
    injectHints("<html><head></head></html>", dir),
    "<html><head></head></html>",
    "a page with no scripts is left alone",
  );
});

test("the server sends the page with its hints, compressed and with an ETag that changes with them, and answers 304", async () => {
  const dir = exportDir();
  const route = createAppFilesRoute({ dir: () => dir });
  const server = http.createServer((req, res) => {
    if (!route.handle(req, res)) {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const plain = await fetch(`${origin}/`, { headers: { accept: "text/html", "accept-encoding": "identity" } });
    const body = await plain.text();
    assert.match(body, /id="vyre-hints"/);
    assert.equal(plain.headers.get("cache-control"), "no-cache");
    assert.equal(plain.headers.get("content-length"), String(Buffer.byteLength(body)));
    const br = await fetch(`${origin}/`, { headers: { accept: "text/html", "accept-encoding": "br" } });
    assert.equal(await br.text(), body, "compressed, the same page");
    assert.equal(br.headers.get("content-encoding"), "br");
    const etag = plain.headers.get("etag")!;
    const again = await fetch(`${origin}/`, { headers: { accept: "text/html", "if-none-match": etag } });
    assert.equal(again.status, 304);
    // another chunk list in the entry: another page, so another ETag
    fs.appendFileSync(path.join(dir, `_expo/static/js/web/index-${H}.js`), `;z=[${list(u("files"), sh(9))}]`);
    const moved = await fetch(`${origin}/`, { headers: { accept: "text/html", "accept-encoding": "identity" } });
    assert.match(await moved.text(), /files-/);
    assert.notEqual(moved.headers.get("etag"), etag);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
