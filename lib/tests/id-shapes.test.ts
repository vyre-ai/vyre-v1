// The id list the product and the tests share must be the repo's own list, must tell an id from a word, and must read an id the way the minters make one.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { id } from "../../manifests/_common.ts";
import { mintId, mintRecordId } from "../ids.ts";
import { ID_PREFIXES, isRawId, rawIdsIn, withoutRawIds } from "../id-shapes.ts";

/** Entries of manifests `id` that are not `<prefix>_<body>` ids: named here, so a new one that nobody parsed cannot pass silently. */
const NOT_PREFIXED = new Set(["recordType", "handle", "connector", "trace"]);

test("every entry of the contracts' id table is a prefix this list has; one it cannot parse fails the test", () => {
  for (const [key, schema] of Object.entries(id)) {
    if (NOT_PREFIXED.has(key)) continue;
    const m = /^\^([a-z]+)_\[a-z0-9\]\+\$$/.exec((schema as { pattern?: string }).pattern ?? "");
    assert.ok(
      m,
      `manifests/_common.ts id.${key} has a shape this test cannot parse: ${(schema as { pattern?: string }).pattern}`,
    );
    assert.ok(ID_PREFIXES.includes(m[1]!), `prefix ${m[1]} (id.${key}) is missing from ID_PREFIXES`);
  }
});

test("every prefix a minter call in modules, host and lib passes is in ID_PREFIXES (tpl_ and the rest)", () => {
  const root = path.resolve(import.meta.dirname, "../..");
  const found = new Set<string>();
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === "tests" || e.name === "fixtures" || e.name.startsWith(".")) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name))
        for (const m of fs.readFileSync(p, "utf8").matchAll(/\b(?:mintId|newId|mint)\(\s*["'`]([a-z]{2,5})["'`]/g))
          found.add(m[1]!);
    }
  };
  for (const d of ["modules", "host", "lib"]) walk(path.join(root, d));
  assert.ok(found.size > 30, "the scan found the minters' prefixes");
  assert.deepEqual(
    [...found].filter((p) => !ID_PREFIXES.includes(p)),
    [],
  );
  assert.ok(ID_PREFIXES.includes("tpl"));
});

test("an id made by the minters is an id; every prefix, every body form", () => {
  for (const p of ID_PREFIXES) {
    for (const made of [
      mintId(p),
      mintId(p).replaceAll("-", ""),
      `${p}_${"0123456789abcdef".repeat(2)}`,
      `${p}_ec028017ceefaf270b`,
    ])
      assert.ok(isRawId(made), made);
  }
  assert.ok(isRawId(mintRecordId()));
});

test("ordinary words, and a value that only starts with a prefix, are not ids", () => {
  for (const w of [
    "not_applicable",
    "tsk_followup",
    "fil_quarterly-report",
    "run_scheduler",
    "num_columns",
    "con_artists",
    "dec_checkpoint",
    "out_standing",
    "usr_maya",
    "rec_ord",
    "run_all_tests",
    "user_name",
    "tsk_bbbbbbbb01",
    "usr_ec028017ceefaf270bzz",
    "thr_0123456789abcdef",
  ]) {
    assert.equal(isRawId(w), false, w);
    assert.deepEqual(rawIdsIn(`See ${w} for details`), [], w);
  }
  assert.deepEqual(
    rawIdsIn("Spring launch fld_01a1d27b165742ddb20032cbd182aaf9 Launch on usr_5b6f9d9e0e318704d0 done"),
    ["fld_01a1d27b165742ddb20032cbd182aaf9", "usr_5b6f9d9e0e318704d0"],
  );
  assert.equal(withoutRawIds("Launch on usr_5b6f9d9e0e318704d0 now"), "Launch on now");
});
