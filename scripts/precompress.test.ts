// The export's text files are compressed once at build time (scripts/lib/precompress.mjs, run by scripts/app-export.mjs): a .br and a .gz beside each, only where it saves bytes, nothing under 1 KB.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { precompress } from "./lib/precompress.mjs";

test("every text file of an export gets a brotli and a gzip copy that unpack to it; pictures and tiny files get none", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-precompress-"));
  const body = "const a = document.querySelector('input');\n".repeat(2000);
  fs.mkdirSync(path.join(dir, "_expo/static/js/web"), { recursive: true });
  fs.writeFileSync(path.join(dir, "_expo/static/js/web/entry-1.js"), body);
  fs.writeFileSync(path.join(dir, "index.html"), `<!doctype html>${"<p>x</p>".repeat(400)}`);
  fs.writeFileSync(path.join(dir, "tiny.js"), "1");
  fs.writeFileSync(path.join(dir, "pic.png"), Buffer.alloc(4000, 3));
  const r = precompress(dir);
  assert.equal(r.files, 2);
  assert.ok(r.br < r.raw / 5 && r.gz < r.raw / 5);
  const entry = path.join(dir, "_expo/static/js/web/entry-1.js");
  assert.equal(zlib.brotliDecompressSync(fs.readFileSync(`${entry}.br`)).toString(), body);
  assert.equal(zlib.gunzipSync(fs.readFileSync(`${entry}.gz`)).toString(), body);
  assert.ok(fs.existsSync(path.join(dir, "index.html.br")));
  assert.ok(!fs.existsSync(path.join(dir, "tiny.js.br")));
  assert.ok(!fs.existsSync(path.join(dir, "pic.png.br")));
  fs.rmSync(dir, { recursive: true, force: true });
});
