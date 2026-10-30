// The Records sidebar's type list: types a connector or the system writes into hide while empty and show once they hold a record.
import test from "node:test";
import assert from "node:assert/strict";
import { INITIAL_STATE, effectiveType, typeGroups } from "./model.ts";
import type { TypeRow } from "./model.ts";

const row = (key: string, plural: string, rowCount: number, group?: string): TypeRow => ({
  key, title: plural, plural, icon: "records", ...(group !== undefined ? { group } : {}), label: "internal", system: false, rowCount, fieldCount: 3,
}) as TypeRow;

test("empty connector and system types are hidden, and show as soon as they hold a record", () => {
  const types = [row("agent", "Agents", 0), row("contact", "Contacts", 2, "People"), row("envelope", "Envelopes", 0, "Documents"), row("issue", "Issues", 0, "Code"), row("report", "Problem reports", 0, "Support"), row("task", "Tasks", 0, "Work")];
  const keys = (t: TypeRow[]): string[] => typeGroups(t).flatMap((g) => g.items.map((i) => i.key));
  assert.deepEqual(keys(types), ["contact", "task"], "Tasks and Contacts are the person's own, so they stay at zero");
  assert.deepEqual(keys(types.map((t) => (t.key === "issue" ? row("issue", "Issues", 1, "Code") : t))), ["contact", "issue", "task"]);
  assert.equal(typeGroups(types)[0]?.items[0]?.key, "contact", "the place opens on the first type that is shown");
  const withAgents = [row("agent", "Agents", 4), ...types];
  assert.ok(!typeGroups(withAgents).some((g) => g.items.some((i) => i.key === "agent")), "Agents are a Manage row, never a type group, even with records");
  assert.equal(effectiveType({ ...INITIAL_STATE, type: "agent" }, typeGroups(withAgents)), "agent", "the Manage row opens the Agents table");
});
