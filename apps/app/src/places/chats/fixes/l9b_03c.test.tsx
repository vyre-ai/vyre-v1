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
/** One row's markup: from its own test id to the next row's (the leading and trailing slots carry ids that end in -leading and -trailing). */
const rowHtml = (out: string, key: string): string => {
  const from = at(out, `data-testid="row-${key}"`);
  const rest = out.slice(from + 10);
  const m = /data-testid="row-(?![^"]*-(?:leading|trailing)")/.exec(rest);
  return out.slice(from, m ? from + 10 + m.index : undefined);
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
  assert.equal(count(out, "Waiting on you"), 4, "Intake, Docs, Billing and Research wait on you; the assistant never says it");
  for (const n of ["Intake", "Docs", "Billing", "Research"]) {
    assert.ok(rowHtml(out, `f:agt_${n.toLowerCase()}`).includes("Waiting on you"), `${n} waits on you`);
  }
  const h = html(createSampleSidebar(harbor));
  assert.equal(count(h, "Waiting on you"), 2, "Harbor: Scheduler and Proofer each have a request for you");
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

test("the sidebar lists all seven requests and no extra project", () => {
  const out = html(createSampleSidebar());
  for (const t of ["Send 12 invoices", "Rivera engagement letter", "County records search", "Pruitt intake summary", "Send the ATP reminder", "Problem report from Omar", "Month-end export"]) assert.ok(has(out, t), t);
  assert.ok(has(out, "pruitt-matter") && !has(out, "atp-q4"), "Projects hold only the followed pruitt-matter");
});

test("agents and people wear real faces, the assistant the Vyre mark", () => {
  const out = html(createSampleSidebar());
  for (const n of ["Assistant", "Intake", "Docs", "Billing", "Research", "Maya Chen"]) assert.ok(has(out, `data-testid="face-${n}"`), n);
  assert.ok(has(out, "<svg"), "faces are drawn, not letters");
});

test("Harbor Studio, from the shared fixtures: its two requests, Scheduler and Proofer, studio and galleries, the Moreno chats", () => {
  const out = html(createSampleSidebar(harbor));
  for (const t of ["Send the Moreno gallery", "Saturday call sheet", "Scheduler", "Proofer", "Moreno shoot Saturday", "Moreno gallery"]) assert.ok(has(out, t), t);
  assert.ok(has(out, 'data-testid="head-needs"') && has(out, 'data-testid="head-channels"'));
  assert.ok(has(out, ">studio<") && has(out, ">galleries<"));
  assert.equal(harbor.name, "Harbor Studio");
  assert.equal(northwind.name, "Northwind");
});

function has(s: string, needle: string): boolean { return s.includes(needle); }

test("unread chats and channels have a bold title (Row emphasis); read ones do not", () => {
  const out = html(createSampleSidebar());
  const title = (key: string, text: string): string => {
    const row = rowHtml(out, key);
    return row.slice(row.indexOf(`>${text}<`) - 220, row.indexOf(`>${text}<`));
  };
  assert.ok(/font-weight:\s*(600|700|bold)/.test(title("ch:intake", "intake")), "unread #intake is bold");
  assert.ok(!/font-weight:\s*(600|700|bold)/.test(title("ch:billing", "billing")), "read #billing is not");
  assert.ok(/font-weight:\s*(600|700|bold)/.test(title("c:c3", "October invoices")), "unread chat is bold");
  assert.ok(!/font-weight:\s*(600|700|bold)/.test(title("c:c6", "County records search")), "read chat is not");
});
