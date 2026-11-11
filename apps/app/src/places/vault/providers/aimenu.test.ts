import test from "node:test";
import assert from "node:assert/strict";
import { aiMenu } from "./aiMenu.ts";
import type { PickRow } from "./pick.ts";

const credits: PickRow = { id: "prv_a", name: "Team credits", handle: "#Team_Credits", scope: "shared", state: "ok", capCents: 50000, uses: { automations: true } };
const chats: PickRow = { id: "prv_o", name: "OpenCode", handle: "#OpenCode", scope: "shared", state: "ok", uses: { teamChats: { who: "everyone" } } };
const labels = (e: ReturnType<typeof aiMenu>): string[] => e.flatMap((x) => ("label" in x ? [x.label] : []));

test("the menu lists Automatic and only the accounts kept for the work, with the cap", () => {
  assert.deepEqual(labels(aiMenu([credits, chats], "automations", undefined, () => undefined)), ["Automatic", "Team credits (up to $500 a month)"]);
});

test("with nothing kept for the work the menu says so once and links to the Vault", () => {
  let opened = 0;
  const e = aiMenu([chats], "automations", undefined, () => undefined, { openVault: () => { opened += 1; } });
  assert.deepEqual(labels(e), ["Automatic", "None kept for automations", "Open Vault, AI accounts"]);
  const link = e.find((x) => "label" in x && x.label === "Open Vault, AI accounts");
  if (link && "onSelect" in link) link.onSelect?.();
  assert.equal(opened, 1);
  assert.equal(e.some((x) => "label" in x && x.disabled === true), true, "the line is not a choice");
});

test("while the accounts are still loading the menu says Loading and never claims that none are kept", () => {
  const e = aiMenu(null, "automations", undefined, () => undefined, { openVault: () => undefined });
  assert.deepEqual(labels(e), ["Automatic", "Loading…"]);
  assert.equal(e.some((x) => "label" in x && /None kept|Open Vault/.test(x.label)), false);
  assert.equal(e.some((x) => "label" in x && x.label === "Loading…" && x.disabled === true), true);
});
