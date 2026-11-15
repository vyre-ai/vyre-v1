// The code a person checks when they join or sign in to a server by its address is the one its admin reads in the Console (Space, Key fingerprint): the same row, so equal for the same server and
// different for another. Two real daemons; the public read (identity.sign_in_options, what the join page reads before any account) against the admin's own read (spaces.get).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startDaemon, stopper } from "../apps/app/tests/real-app-harness.test.ts";

const TOKEN = "e2e-owner-bootstrap-token";
async function post(url: string, cap: string, auth: boolean): Promise<Record<string, any>> {
  const r = await fetch(`${url}/v1/${cap.replaceAll(".", "/")}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${TOKEN}` } : {}) },
    body: "{}",
  });
  const body = (await r.json()) as { data?: Record<string, any> };
  assert.equal(r.status, 200, `${cap}: ${JSON.stringify(body).slice(0, 200)}`);
  return body.data ?? (body as Record<string, any>);
}
async function codes(space: string): Promise<{ public: string; admin: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-code-"));
  const d = await startDaemon(dir, ["--space", space, "--space-name", "Code Co"]);
  try {
    const pub = (await post(d.url, "identity.sign_in_options", false))["fingerprint"] as string;
    const admin = ((await post(d.url, "spaces.get", true))["space"] as { fingerprint: string }).fingerprint;
    return { public: pub, admin };
  } finally {
    await stopper(d.child)();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("the code a joiner sees at an address equals the Console's Key fingerprint for the same server, and differs for another", async () => {
  const a = await codes("spc_code_alpha_0123456789abcdef");
  const b = await codes("spc_code_bravo_0123456789abcdef");
  assert.ok(a.public && a.public.length >= 8, `a code exists: ${a.public}`);
  assert.equal(a.public, a.admin, "the joiner's code is the admin's code");
  assert.equal(b.public, b.admin);
  assert.notEqual(a.public, b.public, "another server has another code");
});
