// The Space browser image's copy of the Chrome bridge protocol module: a link in the repository, a real file in the build context, and the same bytes as the daemon serves.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stageBridge } from "./computer.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("in the repository the browser's bridge module is a link to the one daemon file", () => {
  const link = path.join(REPO, "images/space-browser/browserd/vendor/chrome-bridge.ts");
  assert.ok(fs.lstatSync(link).isSymbolicLink(), "a link, so the code is one file");
  assert.equal(fs.realpathSync(link), fs.realpathSync(path.join(REPO, "lib/chrome-bridge.ts")));
});

test("staging replaces the link with a copy of the same bytes, and runs twice", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-stage-bridge-"));
  try {
    fs.mkdirSync(path.join(root, "lib"), { recursive: true });
    fs.mkdirSync(path.join(root, "images/space-browser/browserd/vendor"), { recursive: true });
    fs.writeFileSync(path.join(root, "lib/chrome-bridge.ts"), "export const x = 1;\n");
    fs.symlinkSync("../../../../lib/chrome-bridge.ts", path.join(root, "images/space-browser/browserd/vendor/chrome-bridge.ts"));
    const rel = stageBridge(root);
    const to = path.join(root, rel);
    assert.ok(fs.lstatSync(to).isFile() && !fs.lstatSync(to).isSymbolicLink(), "a real file in the build context");
    assert.equal(fs.readFileSync(to, "utf8"), "export const x = 1;\n");
    assert.equal(stageBridge(root), rel);
    assert.equal(fs.readFileSync(path.join(root, "lib/chrome-bridge.ts"), "utf8"), "export const x = 1;\n", "the daemon's file is untouched");
    fs.rmSync(path.join(root, "lib/chrome-bridge.ts"));
    assert.throws(() => stageBridge(root), /chrome-bridge\.ts is missing/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
