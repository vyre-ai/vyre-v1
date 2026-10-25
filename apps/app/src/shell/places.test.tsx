// The shell registry: every place is registered with a lazy route and a data provider, and draws data from the replica of the open Space, not its loading frame.
// Seeded replicas come from the Home samples (Northwind, a Personal Space) plus one list per other place registered on the same replica.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentType } from "react";
import { createSampleHomeB } from "../places/home/sections-b/sample.ts";
import type { SampleHomeB, Variant } from "../places/home/sections-b/sample.ts";
import { PLACES, loaderFor } from "../startup/places.ts";
import { FIRST_LISTS, listItems } from "./providers/first-list.tsx";
import { GO_TARGETS } from "./providers/home.tsx";
import { ShellRuntimeProvider } from "./providers/runtime.tsx";
import type { ShellRuntime, ShellTarget } from "./providers/runtime.tsx";
import { SHELL_PLACES, registerShellPlaces, shellPlace } from "./places.ts";

type Loose = { resolve(cap: string, r: (t: unknown, i: unknown) => unknown): void };

/** The rows each place's first list reads, by capability (the output shape of generated/types.ts). */
const SEED: Record<string, { cap: string; out: unknown }> = {
  chat: { cap: "chat.recent", out: { starred: [{ threadId: "thr_1", kind: "chat", title: "Pruitt retainer thread", unread: 1 }], recent: [{ threadId: "thr_2", kind: "channel", title: "Billing room", unread: 0 }] } },
  mail: { cap: "inbox.list_by_contact", out: { rows: [{ id: "con_1", address: "marcus@pruitt.example", displayName: "Marcus Pruitt", lastPreview: "Thanks, I will sign tonight" }] } },
  records: { cap: "views.list", out: { views: [{ viewId: "vw_1", type: "client", kind: "table", title: "Active clients" }] } },
  files: { cap: "files.list", out: { files: [{ fileId: "fil_1", name: "Rivera engagement letter.docx", kind: "document" }] } },
  sites: { cap: "sites.list", out: { sites: [{ siteId: "sit_1", name: "Northwind website", kind: "site" }] } },
  automations: { cap: "automations.list", out: { automations: [{ id: "aut_1", name: "Welcome new leads", status: "on" }] } },
  vault: { cap: "vault.items.list", out: { items: [{ id: "vlt_1", name: "Stripe restricted key", kind: "api_key" }] } },
  settings: { cap: "settings.pages", out: { pages: [{ key: "profile", title: "Profile", group: "everywhere" }] } },
};

function runtimeFor(variant: Variant, seed: boolean, o: { calendarConnected?: boolean } = {}): { rt: ShellRuntime; sample: SampleHomeB; opened: ShellTarget[]; urls: string[] } {
  const sample = createSampleHomeB(variant, o);
  const opened: ShellTarget[] = [];
  const urls: string[] = [];
  if (seed) for (const { cap, out } of Object.values(SEED)) (sample.replica as unknown as Loose).resolve(cap, () => out);
  const d = sample.data;
  const rt: ShellRuntime = {
    screens: d.screens, call: d.call, connection: d.connection, principals: d.principals, recordTitle: d.recordTitle, me: d.me, clock: d.clock,
    space: { id: sample.replica.spaceId, kind: variant === "personal" ? "personal" : "team", name: sample.extras.space.name },
    assistant: sample.extras.assistant,
    get aiConnected() { return sample.extras.aiConnected; },
    calendarConnected: sample.extras.calendarConnected,
    open: (t) => void opened.push(t),
    openUrl: (u) => void urls.push(u),
  };
  return { rt, sample, opened, urls };
}

async function mount(id: string, rt: ShellRuntime | null): Promise<string> {
  const mod = await loaderFor(id)();
  const Place = mod.default as ComponentType<{ place: string }>;
  const tree = <Place place={id} />;
  const out = renderToStaticMarkup(rt ? <ShellRuntimeProvider value={rt}>{tree}</ShellRuntimeProvider> : tree);
  return out.replaceAll("<!-- -->", "");
}

test("all nine places are registered, each with a lazy route and the generated screens of its place", () => {
  registerShellPlaces();
  registerShellPlaces();
  assert.deepEqual(SHELL_PLACES.map((p) => p.label), ["Home", "Chats", "Inbox", "Records", "Files", "Apps", "Automations", "Vault", "Settings"]);
  for (const p of SHELL_PLACES) {
    assert.ok((PLACES as readonly string[]).includes(p.id), `${p.id} is an app route`);
    assert.equal(loaderFor(p.id), p.load, `${p.id} routes to its own loader`);
    assert.ok(p.load() instanceof Promise, `${p.id} loads lazily`);
  }
  assert.equal(shellPlace("vault")?.screens, "vault");
  assert.equal(shellPlace("nowhere"), undefined);
});

test("every place with a first list reads a live query of a generated screen", () => {
  for (const p of SHELL_PLACES) {
    if (p.id === "home") continue;
    const cfg = FIRST_LISTS[p.id];
    assert.ok(cfg, `${p.id} has a first list`);
    const { rt } = runtimeFor("northwind", true);
    const q = rt.screens.query(cfg.screen, cfg.query, cfg.state ?? {});
    assert.equal(q.getSnapshot().status, "ready", `${p.id} reads ${cfg.screen}.${cfg.query} from the replica`);
  }
});

test("each place renders its data from a seeded replica, not its loading frame", async () => {
  registerShellPlaces();
  const { rt } = runtimeFor("northwind", true);
  const titles: Record<string, string> = {
    home: "Send 12 invoices", chat: "Pruitt retainer thread", mail: "Marcus Pruitt", records: "Active clients", files: "Rivera engagement letter.docx",
    sites: "Northwind website", automations: "Welcome new leads", vault: "Stripe restricted key", settings: "Profile",
  };
  for (const p of SHELL_PLACES) {
    const out = await mount(p.id, rt);
    assert.ok(out.includes(titles[p.id]!), `${p.id} shows ${titles[p.id]}`);
    assert.ok(!out.includes("-loading"), `${p.id} is not a loading frame`);
    assert.ok(!out.includes('data-testid="place-loading"'), `${p.id} is not the place frame`);
    assert.ok(!out.includes(String.fromCharCode(0x2014)), `${p.id} has no em dash`);
  }
});

test("before the Space's runtime exists a place draws its loading frame, never a blank page", async () => {
  for (const p of SHELL_PLACES) {
    const out = await mount(p.id, null);
    assert.ok(out.includes("-loading") || out.includes("place-loading"), `${p.id} draws a frame`);
  }
});

test("a place whose list is empty says so with the shared empty state", async () => {
  const { rt, sample } = runtimeFor("northwind", true);
  (sample.replica as unknown as Loose).resolve("files.list", () => ({ files: [] }));
  const out = await mount("files", rt);
  assert.ok(out.includes("No files here yet."));
  assert.ok(!out.includes("Rivera engagement letter.docx"));
  assert.deepEqual(listItems({ files: [] }), []);
});

test("list items take a key, a title and a quiet second line from whatever the capability returns", () => {
  assert.deepEqual(listItems({ views: [{ viewId: "a", title: "Active", kind: "table" }], other: [{ id: "b", displayName: "Marcus" }, { id: "b", name: "dup" }] }), [
    { key: "a", title: "Active", note: "table" }, { key: "b", title: "Marcus" },
  ]);
  assert.deepEqual(listItems(null), []);
});

test("Home in a Team Space draws the whole page and the checklist, Today, Starred and Ask box around it", async () => {
  const { rt } = runtimeFor("northwind", false);
  const out = await mount("home", rt);
  for (const id of ["s-needs", "s-work", "s-risk", "s-away", "s-routines", "s-today", "s-starred", "s-ask"]) assert.ok(out.includes(`data-testid="${id}"`), id);
  assert.ok(out.includes("Good morning, Irfad"));
});

test("Home in a Personal Space draws only the personal variant: checklist, Starred and the Ask box, and Today once a calendar is connected", async () => {
  const out = await mount("home", runtimeFor("personal", false).rt);
  assert.ok(out.includes('data-testid="home-place"'));
  assert.ok(out.includes("Good morning, Irfad"));
  assert.ok(out.includes('data-testid="s-first"'), "the first-run checklist");
  assert.ok(out.includes('data-testid="s-starred"') && out.includes('data-testid="s-ask"'));
  assert.ok(!out.includes('data-testid="s-today"'), "Today needs a connected calendar");
  for (const id of ["s-needs", "s-work", "s-risk", "s-away", "s-routines"]) assert.ok(!out.includes(`data-testid="${id}"`), `${id} is not in a Personal Space`);
  assert.ok(!out.includes("Needs you") && !out.includes("My work"));
  const withCalendar = await mount("home", runtimeFor("personal", false, { calendarConnected: true }).rt);
  assert.ok(withCalendar.includes('data-testid="s-today"'));
  assert.ok(!withCalendar.includes('data-testid="s-needs"'));
});

test("the shell picks the Home variant by the kind of Space and never mixes the two", async () => {
  const team = await mount("home", runtimeFor("harbor", false).rt);
  const personal = await mount("home", runtimeFor("personal", false).rt);
  assert.ok(team.includes('data-testid="s-needs"') && team.includes('data-testid="s-work"'));
  assert.ok(!personal.includes('data-testid="s-needs"') && !personal.includes('data-testid="s-work"'));
});

test("every button of the checklist leads somewhere through the shell's one door", () => {
  const { rt, opened } = runtimeFor("northwind", false);
  for (const [name, target] of Object.entries(GO_TARGETS)) {
    rt.open(target);
    assert.ok(target.screen, `${name} opens a screen`);
  }
  assert.equal(opened.length, Object.keys(GO_TARGETS).length);
});
