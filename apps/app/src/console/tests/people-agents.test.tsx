// People's own agents in the Console: one summary row per person, never a name, an instruction or a chat; a spend cap and Pause all are the whole of what an admin does with them.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ConsoleDataProvider } from "../shell/data.tsx";
import { createSampleConsole } from "../shell/sample.ts";
import { PeoplesAgents } from "../pages/Agents.tsx";
import { CAP_OPTIONS, capKey, dollars, spendPct, summaryNote, whatLine } from "../pages/people-agents-model.ts";

const draw = (rows: Record<string, unknown>): string => {
  const base = createSampleConsole().data;
  const data = { ...base, screens: { ...base.screens, capQuery: (cap: string) => { const value = { status: "ready", data: rows[cap] }; return { subscribe: () => () => undefined, getSnapshot: () => value }; } } as never };
  return renderToStaticMarkup(<ConsoleDataProvider value={data}><PeoplesAgents /></ConsoleDataProvider>).replaceAll("<!-- -->", "");
};
const PEOPLE = [
  { personId: "usr_maya", assistant: true, privateAgents: 2, spendMonthMicros: 12_000_000, capMicros: 50_000_000, paused: false },
  { personId: "usr_lena", assistant: true, privateAgents: 0, spendMonthMicros: 5_000_000, paused: true },
];

test("the words of a row: what exists counted, spend against the cap, Paused", () => {
  assert.equal(whatLine(PEOPLE[0]!), "Assistant + 2 private agents");
  assert.equal(whatLine({ assistant: true, privateAgents: 1 }), "Assistant + 1 private agent");
  assert.equal(whatLine({ assistant: false, privateAgents: 0 }), "No agents");
  assert.equal(summaryNote(PEOPLE[0]!), "Assistant + 2 private agents · $12 this month of $50");
  assert.equal(summaryNote(PEOPLE[1]!), "Paused · Assistant · $5 this month, no cap");
  assert.equal(spendPct(PEOPLE[0]!), 24);
  assert.equal(capKey(PEOPLE[0]!), "50");
  assert.equal(capKey(PEOPLE[1]!), "0");
  assert.equal(dollars(1_499_999), "$1");
  assert.deepEqual(CAP_OPTIONS.map((o) => o.title), ["$25", "$50", "$100", "$200", "No cap"]);
});

test("one row per person with a cap and Pause all, and nothing that names or opens an agent", () => {
  const out = draw({ "agents.people_summary": { people: PEOPLE } });
  assert.ok(out.includes("People&#x27;s own agents") && out.includes("Assistant + 2 private agents"));
  assert.ok(out.includes('data-testid="row-person-agents-usr_maya"') && out.includes('data-testid="person-pause-usr_maya"'));
  assert.ok(out.includes("Resume all"), "a paused person offers Resume all");
  assert.ok(out.includes("never listed by name here") && out.includes("admins cannot open, read or edit them"));
  assert.ok(!out.includes('data-testid="agent-new"') && !/Contracts|instructions|Open agent/.test(out), "no agent to open");
});

test("nobody to govern: no section at all", () => {
  assert.equal(draw({ "agents.people_summary": { people: [] } }), "");
});
