import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ClaimOwner } from "./ClaimOwner.tsx";

const base = { space: "northwind", newCode: () => "ABCD-EFGH-JKMN-PQRS", onClaim: async () => undefined };

test("claim screen: a fresh link shows the details form for the owner", () => {
  const out = renderToStaticMarkup(<ClaimOwner {...base} />);
  for (const id of ["claim-name", "claim-username", "claim-password", "claim-confirm", "claim-next"]) assert.ok(out.includes(`data-testid="${id}"`), id);
  assert.ok(out.includes("Set up northwind"));
});

test("claim screen: a link already used shows one plain line and no form", () => {
  const out = renderToStaticMarkup(<ClaimOwner {...base} dead="used" onSignIn={() => undefined} />);
  assert.ok(out.includes("This link was already used."));
  assert.ok(!out.includes('data-testid="claim-password"'));
  assert.ok(out.includes('data-testid="claim-sign-in"'));
  assert.ok(renderToStaticMarkup(<ClaimOwner {...base} dead="expired" />).includes("This link has expired."));
});

test("claim screen: with no Space name the title is about the person, never a host or an address", () => {
  const out = renderToStaticMarkup(<ClaimOwner {...base} space={null} />);
  assert.ok(out.includes("Create your account"));
  assert.ok(!/127\.0\.0\.1|localhost/.test(out));
});

test("claim screen: Back leaves the details when the caller allows it, and is not offered when it does not", () => {
  assert.ok(renderToStaticMarkup(<ClaimOwner {...base} onBack={() => undefined} />).includes('data-testid="back"'));
  assert.ok(!renderToStaticMarkup(<ClaimOwner {...base} />).includes('data-testid="back"'));
});
