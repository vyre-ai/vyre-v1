// Finding F35: an item kept where an agent cannot use it says so before a person tries. Every answer is access.clears; the screens never work a clearance out.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { WhoCanUse } from "../itemenv/WhoCanUse.tsx";
import {
  agentsThatCannot,
  moveChoices,
  moveEntries,
  BARRED_FOLDER_REASON,
  CANT_USE_NOTE,
} from "../itemenv/restricted.ts";
import type { Share } from "../layout/model.ts";

const calls: { principal: { id: string }; target: { id: string } }[] = [];
const call =
  (cannot: string[]) =>
  async (cap: string, input: unknown): Promise<unknown> => {
    assert.equal(cap, "access.clears");
    const i = input as { principal: { id: string }; target: { id: string } };
    calls.push(i);
    return { clears: !cannot.includes(`${i.principal.id}|${i.target.id}`) };
  };

test("which agents cannot use an item where it is kept: only agents are asked, once each", async () => {
  calls.length = 0;
  const out = await agentsThatCannot(call(["agt_billing|vit_1"]), { type: "vault_item", id: "vit_1" }, [
    { kind: "agent", id: "agt_billing" },
    { kind: "agent", id: "agt_billing" },
    { kind: "agent", id: "agt_docs" },
    { kind: "person", id: "usr_sam" },
  ]);
  assert.deepEqual([...out], ["agt_billing"]);
  assert.equal(calls.length, 2, "a person is never asked and an agent listed twice is asked once");
});

test("a question the access module cannot answer reads as yes, so the screen never says no on a guess", async () => {
  const boom = async (): Promise<unknown> => {
    throw new Error("not found");
  };
  assert.equal(
    (await agentsThatCannot(boom, { type: "vault_item", id: "vit_1" }, [{ kind: "agent", id: "agt_a" }])).size,
    0,
  );
});

test("Move: Mine and the folders every named agent can use are choosable, the others sit under Restricted and are not", async () => {
  const folders = [
    { id: "vfd_mine", name: "Mine", scope: "mine" as const },
    { id: "vfd_mkt", name: "Marketing", scope: "shared" as const },
    { id: "vfd_fin", name: "Finance", scope: "shared" as const },
    { id: "vfd_here", name: "Where it is", scope: "shared" as const },
  ];
  const choices = await moveChoices(
    call(["agt_billing|vfd_fin"]),
    folders,
    [{ kind: "agent", id: "agt_billing" }],
    "vfd_here",
  );
  assert.deepEqual(
    choices.usable.map((f) => f.name),
    ["Mine", "Marketing"],
  );
  assert.deepEqual(
    choices.barred.map((f) => f.name),
    ["Finance"],
  );
  const picked: string[] = [];
  const entries = moveEntries(choices, (id) => picked.push(id));
  const labels = entries.map((e) => ("head" in e ? `# ${e.head}` : "label" in e ? e.label : "-"));
  assert.deepEqual(labels, ["# Move to", "Mine", "Marketing", "# Restricted", "Finance"]);
  const fin = entries.find((e) => "label" in e && e.label === "Finance") as {
    disabled?: boolean;
    reason?: string;
    onSelect?: unknown;
  };
  assert.equal(fin.disabled, true);
  assert.equal(fin.reason, BARRED_FOLDER_REASON);
  assert.equal(fin.onSelect, undefined, "choosing it does nothing: there is nothing to run");
});

const shares: Share[] = [
  { subject: { kind: "agent", id: "agt_billing" }, level: "use", through: "direct" },
  { subject: { kind: "agent", id: "agt_docs" }, level: "use", through: "direct" },
];
const who = (over: Partial<Parameters<typeof WhoCanUse>[0]> = {}): string =>
  renderToStaticMarkup(
    <WhoCanUse
      shares={shares}
      you={{ name: "Irfad", level: "manage", owner: true }}
      nameOf={(s) => (s.id === "agt_billing" ? "Billing" : "Docs")}
      meId="usr_irfad"
      canManage
      onLevel={() => undefined}
      onRemove={() => undefined}
      onShare={() => undefined}
      onMenu={() => undefined}
      {...over}
    />,
  )
    .replaceAll("<!-- -->", "")
    .replaceAll("&#x27;", "'");

test("the item page puts one line under an agent whose share cannot work, with Move, and leaves the others alone", () => {
  const html = who({ cannotUse: new Set(["agt_billing"]), onMove: () => undefined });
  assert.ok(html.includes(CANT_USE_NOTE), html);
  assert.equal((html.match(/Can't use this while it's Restricted/g) ?? []).length, 1);
  assert.match(html, /data-testid="who-move-agent:agt_billing"/);
  assert.doesNotMatch(html, /who-move-agent:agt_docs/);
});

test("without Manage there is no Move to offer, and with nothing barred there is no line at all", () => {
  assert.doesNotMatch(
    who({ cannotUse: new Set(["agt_billing"]), onMove: () => undefined, canManage: false }),
    /who-move-/,
  );
  assert.doesNotMatch(who({ cannotUse: new Set() }), /Restricted/);
});
