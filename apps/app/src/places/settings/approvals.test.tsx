// Settings > Privacy and security > Approvals: the Always let rules from gate.allow.list, one line per agent and recipient, each removable with gate.allow.remove; only the Always let ones.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsDataProvider } from "./data.tsx";
import { SettingsPlace } from "./SettingsPlace.tsx";
import { approvalLine, alwaysLet } from "./Approvals.tsx";
import { createSampleSettings, northwind } from "./sample.ts";

const html = (s: ReturnType<typeof createSampleSettings>, page: string): string => renderToStaticMarkup(<SettingsDataProvider value={s.data}><SettingsPlace width={1280} initialPage={page as never} /></SettingsDataProvider>).replaceAll("<!-- -->", "").replaceAll("&#x27;", "'");

test("an Always let rule reads as who can do what to whom without asking", () => {
  const names = (id: string): string => ({ agt_dex: "Dex", usr_aliza: "Aliza Rizvi", chn_ops: "#ops" } as Record<string, string>)[id] ?? id;
  assert.equal(approvalLine({ act: "send", target: "usr_aliza", agentId: "agt_dex" }, names), "Dex can message Aliza Rizvi without asking");
  assert.equal(approvalLine({ act: "post", target: "chn_ops", agentId: "agt_dex" }, names), "Dex can post to #ops without asking");
  assert.equal(approvalLine({ act: "send", target: "usr_aliza" }, names), "An agent can message Aliza Rizvi without asking");
});

test("only Always let rules are listed, and the page shows each with Remove", () => {
  const s = createSampleSettings(northwind);
  const out = html(s, "signin");
  assert.ok(out.includes('data-testid="approvals"') && out.includes(">Approvals<"));
  assert.ok(out.includes("Dex can message Aliza Rizvi without asking") && out.includes("Dex can post to #ops without asking"));
  assert.ok(!out.includes("Maya") || !out.includes("Dex can message usr_maya"), "a standing rule is the Console's");
  assert.ok(out.includes('data-testid="approval-remove-alw_1"') && out.includes('data-testid="approval-remove-alw_2"') && !out.includes('data-testid="approval-remove-alw_3"'));
});

test("Remove calls gate.allow.remove with that rule, and the rule is gone from the next read", async () => {
  const s = createSampleSettings(northwind);
  const before = alwaysLet(((await s.data.call("gate.allow.list", {})) as { rules: never[] }).rules);
  assert.equal(before.length, 2);
  await s.data.call("gate.allow.remove", { id: "alw_1" });
  assert.deepEqual(s.calls.filter((c) => c.cap === "gate.allow.remove").map((c) => c.input), [{ id: "alw_1" }]);
  const after = alwaysLet(((await s.data.call("gate.allow.list", {})) as { rules: never[] }).rules);
  assert.deepEqual(after.map((r: { id: string }) => r.id), ["alw_2"]);
});

test("with no rules the section says what goes here and how to make one", () => {
  const s = createSampleSettings(northwind);
  for (const r of s.replica.rows("allow")) s.replica.remove("allow", [String(r.id)]);
  const out = html(s, "signin");
  assert.ok(out.includes("Nothing is always allowed") && out.includes("choose Always let"));
});
