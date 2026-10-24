import test from "node:test";
import assert from "node:assert/strict";
import * as lib from "../index.ts";
import { csr } from "../acme/csr.ts";
import crypto from "node:crypto";

test("index exports the public helpers", () => {
  for (const k of ["mintId", "canonical", "covers", "tickHlc", "clampHlc", "frontmatter", "diffLines", "route", "parseExpr", "evalExpr", "holds"]) assert.equal(typeof (lib as Record<string, unknown>)[k], "function", k);
});

test("acme csr: a DER SEQUENCE for an ECDSA key and two names", () => {
  const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const der = csr(["a.example.test", "b.example.test"], privateKey);
  assert.ok(der instanceof Uint8Array || Buffer.isBuffer(der));
  assert.equal(der[0], 0x30);
  assert.ok(Buffer.from(der).includes(Buffer.from("b.example.test")));
});
