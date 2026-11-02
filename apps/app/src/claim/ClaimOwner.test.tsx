import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ClaimOwner } from "./ClaimOwner.tsx";
import { ClaimRoute } from "./ClaimRoute.tsx";

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

const SESSION = { baseUrl: "https://northwind.example", token: "t", personId: "p", marker: "m", username: "maya", def: { spaceId: "spc_north", name: "Northwind", kind: "team", kit: "k", skinDefault: "s" } };
const withStored = (sessions: Record<string, unknown>, run: () => void): void => {
  const g = globalThis as { localStorage?: unknown };
  const had = g.localStorage;
  const data = new Map([["vyre.session.v1", JSON.stringify({ sessions })]]);
  g.localStorage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
  try { run(); } finally { g.localStorage = had; }
};
const route = (hash: string): string => renderToStaticMarkup(<ClaimRoute token="tok" address="https://northwind.example" fragment={hash} onDone={() => undefined} onSignIn={() => undefined} />);

test("claim route: a link to a Space this browser is already in says so at once, with no form to fill and a way in", () => {
  withStored({ "https://northwind.example": SESSION }, () => {
    const out = route("#s=spc_north");
    assert.ok(out.includes("This link was already used."));
    assert.ok(out.includes(">Open<"));
    assert.ok(!out.includes('data-testid="claim-name"'));
  });
});

test("claim route: a session on another Space at the same address does not spend the link, so a wiped Space can be set up again", () => {
  withStored({ "https://northwind.example": SESSION }, () => assert.ok(route("#s=spc_fresh").includes('data-testid="claim-name"')));
  withStored({}, () => assert.ok(route("#s=spc_north").includes('data-testid="claim-name"')));
});
