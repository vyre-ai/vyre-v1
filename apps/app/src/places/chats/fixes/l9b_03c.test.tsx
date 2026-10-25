// P-L9b_03c: the Chats list for Northwind and Harbor Studio as the prototype draws it: Needs you as one row with the inbox glyph and the count with its requests beneath,
// every agent that raised a request saying "Waiting on you", channels dim until something new, and real faces (the shared Avatar, not letters).
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatsSidebar } from "../sidebar/ChatsSidebar.tsx";
import { buildEntries, groupRecent, waitingAgents } from "../sidebar/model.ts";
import type { Agent, NeedsItem } from "../sidebar/model.ts";
import { createSampleSidebar, harbor, northwind } from "../sidebar/sample.ts";
import type { SampleSidebar } from "../sidebar/sample.ts";

const html = (s: SampleSidebar): string => renderToStaticMarkup(<ChatsSidebar data={s.data} window={{ start: 0, end: 500 }} />).replaceAll("<!-- -->", "");
const at = (s: string, needle: string): number => {
  const i = s.indexOf(needle);
  assert.ok(i >= 0, `expected ${needle}`);
  return i;
};
const count = (s: string, needle: string): number => s.split(needle).length - 1;

test("Needs you is one row with the count, and its requests sit under it", () => {
  const out = html(createSampleSidebar());
  assert.ok(has(out, 'data-testid="row-needs-parent"') && has(out, 'data-testid="count-needs"') && has(out, ">7<"));
  assert.ok(at(out, 'data-testid="row-needs-parent"') < at(out, "Send 12 invoices") && at(out, "Send 12 invoices") < at(out, 'data-testid="head-faces"'));
  assert.ok(has(out, "Approve") && has(out, "Review") && has(out, "Blocked"));
});

test("every agent that raised a request says Waiting on you; the others do not", () => {
  const out = html(createSampleSidebar());
  assert.ok(count(out, "Waiting on you") >= 4, "Intake, Docs, Billing and Research wait on you");
  for (const n of ["Intake", "Docs", "Billing", "Research"]) {
    const from = at(out, `data-testid="row-f:agt_${n.toLowerCase()}"`);
    const next = out.indexOf('data-testid="row-', from + 10);
    assert.ok(out.slice(from, next < 0 ? undefined : next).includes("Waiting on you"), `${n} waits on you`);
  }
  assert.ok(!has(html(createSampleSidebar(harbor)), "Waiting on you"), "Harbor has no requests");
});

test("the waiting set covers requests beyond the top three", () => {
  const mk = (by: string): NeedsItem => ({ reason: "ready", task: { id: by, createdBy: by, actions: [] } } as unknown as NeedsItem);
  assert.deepEqual([...waitingAgents([mk("a"), mk("b"), mk("a")])].sort(), ["a", "b"]);
  const agent = (id: string): Agent => ({ agentId: id, name: id } as Agent);
  const e = buildEntries({
    needs: [], needsTotal: 0, faces: [agent("a"), agent("b")], workingAgents: new Set(), waitingAgents: new Set(["b"]),
    groups: groupRecent({ starred: [], today: [], yesterday: [], earlier: [], nextUnread: null }, [], (id) => id), channels: [], filter: "all", closed: new Set(),
  });
  const faces = e.filter((x) => x.type === "face") as Extract<(typeof e)[number], { type: "face" }>[];
  assert.deepEqual(faces.map((f) => [f.agent.agentId, f.waiting]), [["a", false], ["b", true]]);
});

test("channels with nothing new sit dim; the one with unread keeps its count", () => {
  const out = html(createSampleSidebar());
  assert.ok(has(out, 'data-testid="channel-unread-intake"') && has(out, 'data-testid="unread-intake"'));
  for (const id of ["billing", "rivera", "pruitt"]) assert.ok(has(out, `data-testid="channel-read-${id}"`), id);
  assert.ok(at(out, "rivera-matter") < at(out, 'data-testid="group-Projects"'));
});

test("agents and people wear real faces, the assistant the Vyre mark", () => {
  const out = html(createSampleSidebar());
  for (const n of ["Assistant", "Intake", "Docs", "Billing", "Research", "Maya Chen"]) assert.ok(has(out, `data-testid="face-${n}"`), n);
  assert.ok(has(out, "<svg"), "faces are drawn, not letters");
});

test("Harbor Studio: the assistant, three chats, no Needs you and no Channels", () => {
  const out = html(createSampleSidebar(harbor));
  assert.ok(has(out, "Plan the week") && has(out, "Flights to Kuala Lumpur") && has(out, "Tax papers checklist"));
  assert.ok(!has(out, 'data-testid="head-needs"') && !has(out, 'data-testid="head-channels"'));
  assert.equal(harbor.name, "Harbor Studio");
  assert.equal(northwind.name, "Northwind");
});

function has(s: string, needle: string): boolean { return s.includes(needle); }
