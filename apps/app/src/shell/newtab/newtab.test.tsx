// P-L9_32: the new-tab page. Start, Chat with, Recent, Record types and Folders draw while the field is empty; every control leads somewhere; typing is the Cmd-K search.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { NewTabPage } from "./NewTabPage.tsx";
import { START, faceLabel } from "./model.ts";
import { createSampleNewTab } from "./sample.ts";

const html = (): string => renderToStaticMarkup(<NewTabPage data={createSampleNewTab().data} />).replaceAll("<!-- -->", "");
const at = (s: string, needle: string): number => { const i = s.indexOf(needle); assert.ok(i >= 0, `expected ${needle}`); return i; };

test("the sections draw in the prototype's order under the field", () => {
  const out = html();
  const order = ["Open anything, or start something", "Start", "Chat with", "Recent", "Record types", "Folders"].map((t) => at(out, t));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  for (const s of START) assert.ok(out.includes(s.label), s.label);
});

test("faces are first names for people and the agent's name for agents", () => {
  const out = html();
  assert.ok(out.includes(">Maya<") && out.includes(">Intake<"));
  assert.equal(faceLabel({ kind: "person", id: "p", title: "Maya Chen", link: "x", score: 1 }), "Maya");
});

test("Recent carries a kind label at the right; record types are chips", () => {
  const out = html();
  assert.ok(out.includes("Chats") && out.includes("Files"));
  for (const t of ["Agents", "Projects", "Invoices"]) assert.ok(out.includes(t), t);
});

test("Start tiles and record types lead to their place", () => {
  const { data, went } = createSampleNewTab();
  data.start("task");
  data.start("folder");
  data.openType("Hires");
  assert.deepEqual(went, ["home#new=task", "files#new=folder", "records#type=Hires"]);
});

test("every control is a labelled button", () => {
  const out = html();
  for (const l of ["New chat", "Chat with Intake", "Message Maya Chen", "Open Projects"]) assert.ok(out.includes(`aria-label="${l}"`), l);
});

test("the real shell's page reads root folders and record types from the Space and sends them to Files and Records", async () => {
  const { loadNewTabAhead, realNewTabData } = await import("./data.ts");
  const calls: string[] = [];
  const rt = {
    me: { id: "usr_me" },
    principals: { subscribe: () => () => undefined, getSnapshot: () => ({ status: "ready" as const, data: [{ id: "usr_me", name: "Me", kind: "person" }, { id: "agt_a", name: "Intake", kind: "agent" }] }) },
    screens: { query: () => ({ subscribe: () => () => undefined, getSnapshot: () => ({ status: "loading" as const }) }) },
    call: async (cap: string) => {
      calls.push(cap);
      if (cap === "files.tree") return { roots: [{ key: "f1", title: "Projects", kind: "folder", folderId: "fld_1", count: 3 }, { key: "shared", title: "Shared with me", kind: "virtual", count: 0 }] };
      return { types: [{ key: "project", plural: "Projects" }] };
    },
  } as never;
  const ahead = await loadNewTabAhead(rt);
  assert.deepEqual(calls.sort(), ["files.tree", "schema.types.list"]);
  assert.deepEqual(ahead.folders.map((f) => f.title), ["Projects"]);
  const went: string[] = [];
  const base = createSampleNewTab().data;
  const data = realNewTabData(base, rt, { go: (p, h) => void went.push(`${p}#${h ?? ""}`) }, ahead);
  assert.deepEqual(data.faces().map((h) => h.title), ["Intake"], "you are not in your own faces");
  data.open(data.folders()[0]!, { newTab: false });
  data.openType("Projects");
  assert.deepEqual(went, ["files#folder=fld_1", "records#type=project"]);
});
