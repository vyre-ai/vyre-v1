// ui/ConnectCard: every state of the card as words and controls, the reserved error line, the locked fields while a try runs, and the words a person is never given.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ConnectCard } from "./index.tsx";
import type { ConnectCardProps, ConnectState } from "./index.tsx";

const noop = (): void => {};
const FIELDS = [
  { name: "api_key", label: "API key", optional: false },
  { name: "webhook_secret", label: "Webhook secret", optional: true },
];
const base = (state: ConnectState, over: Partial<ConnectCardProps> = {}): ConnectCardProps => ({
  id: "c1",
  state,
  service: "Fathom",
  site: "https://fathom.video",
  agent: "Dex",
  fields: FIELDS,
  values: {},
  onChange: noop,
  keptIn: "Mine",
  onKeptIn: noop,
  open: false,
  onToggle: noop,
  on: { connect: noop, retry: noop, notNow: noop, askAdmin: noop, reopen: noop, disconnect: noop, useDifferent: noop },
  ...over,
});
const html = (state: ConnectState, over: Partial<ConnectCardProps> = {}): string =>
  renderToStaticMarkup(<ConnectCard {...base(state, over)} />);
const plain = (h: string): string =>
  h
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"');
const has = (h: string, ...words: string[]): void => {
  for (const w of words) assert.ok(plain(h).includes(w), `${w} is on the card`);
};
const BANNED = /handle|clearance|restricted beyond|your role/i;

test("Ask: the title, who uses it, one secure field for each thing the service needs, Where to find it, Kept in Mine, Connect and Not now", () => {
  const h = html("ask");
  has(
    h,
    "Connect Fathom",
    "Dex will use it for you.",
    "API key",
    "Webhook secret",
    "Optional",
    "Where to find it",
    "Kept in",
    "Mine",
    "Connect",
    "Not now",
  );
  assert.match(h, /type="password"/);
  assert.match(h, /href="https:\/\/fathom\.video"/);
  assert.equal((h.match(/Where to find it/g) ?? []).length, 1, "the link is on the first field only");
  assert.ok(h.includes("Paste api key") || h.includes("Paste API key") || /Paste/.test(h));
  assert.doesNotMatch(h, BANNED);
});

test("Wrong key: the first field is marked and says which service refused it", () => {
  const h = html("wrong", { values: { api_key: "bad" } });
  has(h, "Fathom didn't accept this key.");
  assert.match(h, /aria-invalid="true"/);
  assert.match(h, /role="alert"/);
});

test("Could not reach: the fields are locked and filled, nothing else can be typed, and Retry and Not now are the way on", () => {
  const h = html("offline", { values: { api_key: "typed" } });
  has(h, "Couldn't reach Fathom.", "Retry", "Not now");
  assert.match(h, /readonly|disabled/i);
  assert.ok(!h.includes(">Connect<"), "no second Connect beside Retry");
  assert.ok(!h.includes("Paste"), "a locked field offers no Paste");
});

test("Working: the fields lock and the steps are Checked, Connected, Saved; the first 300 ms show nothing yet", () => {
  const waiting = html("ask", { work: { steps: ["Checked", "Connected", "Saved"], step: 0, visible: false } });
  assert.match(waiting, /opacity:\s*0/);
  const going = html("ask", { work: { steps: ["Checked", "Connected", "Saved"], step: 1, visible: true } });
  has(going, "Checked", "Connected", "Saved");
  assert.ok(!going.includes(">Not now<"), "no buttons while it works");
  assert.match(going, /readonly|disabled/i);
});

test("Already have one: the saved key is offered, with Connect, Use a different key and Not now", () => {
  const h = html("have", { have: { name: "Fathom", where: "Mine" } });
  has(h, "Use your saved Fathom key", "Mine", "Connect", "Use a different key", "Not now");
  assert.doesNotMatch(h, /type="password"/, "nothing to type until a different key is chosen");
});

test("Needs an admin: the person is told once and offered the admin by name; then Asked, with the time, and it finishes by itself", () => {
  const a = html("admin", { admin: "Maya" });
  has(a, "Only admins can connect services in this Space.", "Ask Maya", "Not now");
  assert.doesNotMatch(a, /<input|href=/, "no field and no link to a page the person cannot open");
  const b = html("asked", { admin: "Maya", askedAt: "10:21" });
  has(b, "Asked Maya", "10:21", "This card finishes when Maya connects it.", "Not now");
});

test("Connected: one row with the service, a tick, Connected and where it is kept; opened it shows Tested, Used by and Disconnect", () => {
  const closed = html("connected");
  has(closed, "Fathom", "Connected", "Kept in Mine");
  assert.ok(!closed.includes("Disconnect"));
  const open = html("connected", { open: true, tested: "Reached Fathom", usedBy: "Dex", connectedBy: "Maya" });
  has(open, "Tested", "Reached Fathom", "Used by", "Dex", "Connected by", "Maya", "Disconnect");
});

test("Not now: one row that says the service is not connected, with Connect to open it again", () => {
  const h = html("later");
  has(h, "Fathom isn't connected", "Connect");
  assert.doesNotMatch(h, /<input/);
});

test("no state carries the words a person is spared", () => {
  for (const s of ["ask", "wrong", "offline", "have", "admin", "asked", "connected", "later"] as const)
    assert.doesNotMatch(html(s, { admin: "Maya", have: { name: "Fathom", where: "Mine" } }), BANNED, s);
});

test("a withdrawn chip never exists", () => {
  for (const s of ["ask", "wrong", "offline", "have", "admin", "asked", "connected", "later"] as const)
    assert.doesNotMatch(html(s), /Withdrawn/);
});
