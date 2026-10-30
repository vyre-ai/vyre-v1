import test from "node:test";
import assert from "node:assert/strict";
import { pinIssuer, tenantOf } from "./oidc-issuer.ts";

test("Google's issuer is fixed by the code whatever is typed", () => {
  assert.deepEqual(pinIssuer("google", "https://evil.example.com"), { issuer: "https://accounts.google.com", free: false });
  assert.deepEqual(pinIssuer("google", undefined), { issuer: "https://accounts.google.com", free: false });
});

test("Microsoft sign-in takes one specific tenant id, never a shared tenant or a name", () => {
  const id = "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0";
  assert.deepEqual(pinIssuer("microsoft", id), { issuer: `https://login.microsoftonline.com/${id}/v2.0`, free: false });
  assert.deepEqual(pinIssuer("microsoft", `https://login.microsoftonline.com/${id.toUpperCase()}/v2.0/`), { issuer: `https://login.microsoftonline.com/${id}/v2.0`, free: false });
  for (const bad of ["common", "organizations", "consumers", "firm.onmicrosoft.com", "https://evil.example.com/x/v2.0", "https://login.microsoftonline.com/common/v2.0", "", "localhost"]) assert.ok("error" in pinIssuer("microsoft", bad), bad);
  assert.equal(tenantOf(`https://login.microsoftonline.com/${id}/v2.0`), id);
  assert.equal(tenantOf("https://login.microsoftonline.com/common/v2.0"), undefined);
});

test("a provider with a free issuer takes only a plain public https address", () => {
  assert.deepEqual(pinIssuer("okta", "https://firm.okta.com/"), { issuer: "https://firm.okta.com", free: true });
  for (const bad of ["http://firm.okta.com", "https://localhost", "https://10.0.0.1", "https://intranet", "https://u:p@firm.okta.com", "https://firm.okta.com/?x=1", "nope"]) assert.ok("error" in pinIssuer("okta", bad), bad);
});
