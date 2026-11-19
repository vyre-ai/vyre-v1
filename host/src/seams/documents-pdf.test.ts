// The documents module's Word-to-PDF seam (lane r42-docs): finds LibreOffice where it is, has no converter where it is not, runs one conversion at a time in a folder of its own that it
// removes, and refuses a converter that says it finished and left nothing or left something that is not a PDF.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDocumentsHost, findSoffice } from "./documents-pdf.ts";

test("soffice is found by name, on the PATH, in the usual places, and a machine without it has none", () => {
  const has = (set: string[]) => (p: string) => set.includes(p);
  assert.equal(findSoffice({ VYRE_SOFFICE: "/x/soffice" }, has(["/x/soffice"])), "/x/soffice");
  assert.equal(findSoffice({ PATH: "/a:/b" }, has(["/b/libreoffice"])), "/b/libreoffice");
  assert.equal(findSoffice({ PATH: "" }, has(["/usr/bin/soffice"])), "/usr/bin/soffice");
  assert.equal(findSoffice({ PATH: "/a" }, has([])), null);
  assert.deepEqual(
    createDocumentsHost({ soffice: undefined, run: async () => ({ code: 0, stderr: "" }) }).pdf === undefined,
    findSoffice() === null,
  );
});

const base = () => fs.mkdtempSync(path.join(os.tmpdir(), "docpdf-test-"));

test("a conversion runs in its own folder, hands back the PDF, and removes the folder", async () => {
  const tmp = base();
  const seen: string[] = [];
  const host = createDocumentsHost({
    soffice: "/fake/soffice",
    tmp,
    run: async (_f, args, o) => {
      seen.push(o.cwd);
      assert.ok(args.includes("--headless") && args.includes("pdf"));
      assert.ok(fs.existsSync(path.join(o.cwd, "in.docx")));
      fs.writeFileSync(path.join(o.cwd, "in.pdf"), "%PDF-1.7 ok");
      return { code: 0, stderr: "" };
    },
  });
  const out = await host.pdf!(new Uint8Array([1, 2, 3]));
  assert.equal(Buffer.from(out).toString(), "%PDF-1.7 ok");
  assert.equal(seen.length, 1);
  assert.deepEqual(fs.readdirSync(tmp), []);
});

test("a converter that fails, leaves nothing, or leaves a file that is not a PDF throws and still removes its folder", async () => {
  const tmp = base();
  for (const how of ["code", "nothing", "notpdf"]) {
    const host = createDocumentsHost({
      soffice: "/fake/soffice",
      tmp,
      run: async (_f, _a, o) => {
        if (how === "notpdf") fs.writeFileSync(path.join(o.cwd, "in.pdf"), "hello");
        return { code: how === "code" ? 1 : 0, stderr: "boom" };
      },
    });
    await assert.rejects(() => host.pdf!(new Uint8Array([1])), /converter/);
    assert.deepEqual(fs.readdirSync(tmp), [], how);
  }
});

test("two conversions at once run one after the other, and a failed one does not stop the next", async () => {
  const tmp = base();
  let running = 0;
  let most = 0;
  let n = 0;
  const host = createDocumentsHost({
    soffice: "/fake/soffice",
    tmp,
    run: async (_f, _a, o) => {
      running++;
      most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, 10));
      running--;
      if (n++ === 0) return { code: 1, stderr: "first fails" };
      fs.writeFileSync(path.join(o.cwd, "in.pdf"), "%PDF-1.7");
      return { code: 0, stderr: "" };
    },
  });
  const [a, b] = await Promise.allSettled([host.pdf!(new Uint8Array([1])), host.pdf!(new Uint8Array([2]))]);
  assert.equal(a.status, "rejected");
  assert.equal(b.status, "fulfilled");
  assert.equal(most, 1);
});
