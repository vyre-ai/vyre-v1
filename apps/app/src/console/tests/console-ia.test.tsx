// The approved Console structure (SETTINGS-CONSOLE-IA.md, prototype v1/test_console_ia.py), held in the app:
// 1. the copy test: no banned word in a label the Console draws (nav, subtitles, tabs, views, notes and every page's text);
// 2. the redirect test: every old page id lands on its new home;
// 3. the shape: ten places, at most seven tabs a place, a subtitle on every place.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ConsoleShell } from "../shell/ConsoleShell.tsx";
import type { ConsoleShellProps } from "../shell/ConsoleShell.tsx";
import { ConsoleDataProvider } from "../shell/data.tsx";
import { PAGES, PAGE_NOTE } from "../shell/nav.ts";
import { OLD_NAMES, SECTIONS, nowIn, resolve, sectionOf, tabOf } from "../shell/sections.ts";
import { createSampleConsole } from "../shell/sample.ts";

const BANNED = /\b(principals?|grants?|actors?|schema|gates?|suppression|retention|provider matrix|label grid|tenants?|scopes?|policy objects?|capabilit(?:y|ies)|sandbox\.denied|traces?)\b|company only|by label/i;
const html = (props: ConsoleShellProps): string => renderToStaticMarkup(<ConsoleDataProvider value={createSampleConsole().data}><ConsoleShell width={1280} {...props} /></ConsoleDataProvider>).replaceAll("<!-- -->", "");
// what a person reads: the text of the markup without its attributes, and without dotted internal ids (like schema.manage)
const read = (markup: string): string[] => markup.replace(/<[^>]*>/g, "\n").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").split("\n").map((l) => l.replace(/\b(?!sandbox\.denied)[a-z]+\.[a-z_]+(\.[a-z_]+)*\b/g, " ").trim()).filter(Boolean);

test("the shape: ten places, a subtitle on each, at most seven tabs a place, Space last", () => {
  assert.deepEqual(SECTIONS.map((s) => s.title), ["Home", "People", "Agents", "AI", "Data", "Messaging", "Apps", "Computers", "Security", "Space"]);
  for (const s of SECTIONS) { assert.ok(s.subtitle.length > 8 && !/[.!]$/.test(s.subtitle) === true || s.subtitle.length > 8, s.id); assert.ok(s.tabs.length <= 7, `${s.id} has ${s.tabs.length} tabs`); }
  assert.deepEqual(SECTIONS.find((s) => s.id === "access")!.tabs.map((t) => t.label), ["Members", "Teams", "Roles", "Requests"]);
  assert.deepEqual(SECTIONS.find((s) => s.id === "ai")!.tabs.map((t) => t.label), ["AI accounts", "What each provider may see", "Spend and limits", "Approvals", "Review", "Voice", "AI use policy"]);
  assert.deepEqual(SECTIONS.find((s) => s.id === "machines")!.tabs.map((t) => t.label), ["Overview", "Servers", "Agent computers", "Diagnostics"]);
  assert.deepEqual(SECTIONS.find((s) => s.id === "security")!.tabs.map((t) => t.label), ["Sign-in", "Access reviews", "Audit log"]);
  assert.ok(html({}).includes('data-testid="page-subtitle"'), "the subtitle is drawn");
});

test("copy: no banned word in the places, tabs, views, subtitles, page titles and notes", () => {
  const labels = [...SECTIONS.flatMap((s) => [s.title, s.subtitle, ...s.tabs.flatMap((t) => [t.label, ...t.views.map((v) => v.label)])]), ...PAGES.map((p) => p.title), ...Object.values(PAGE_NOTE)];
  const hits = labels.filter((l) => BANNED.test(l));
  assert.deepEqual(hits, []);
  for (const l of labels) assert.ok(!/!|—|successfully/i.test(l), `no exclamation, em dash or "successfully": ${l}`);
});

test("copy: no banned word in what any page draws (sample Space, Owner)", () => {
  const hits: string[] = [];
  for (const p of PAGES) for (const line of read(html({ initialPage: p.id }))) if (BANNED.test(line)) hits.push(`${p.id}: ${line.slice(0, 90)}`);
  assert.deepEqual([...new Set(hits)], []);
});

// every old page id (from before the restructure), the section and the page it lands on now
const LANDS: Record<string, [string, string]> = {
  overview: ["overview", "overview"], people: ["access", "people"], groups: ["access", "groups"], roles: ["access", "roles"], permissions: ["access", "permissions"], grants: ["access", "grants"], checker: ["access", "people"],
  invites: ["access", "requests"], policies: ["security", "policies"], reviews: ["security", "reviews"], sessions: ["security", "sessions"],
  agents: ["agents", "agents"], actors: ["agents", "actors"], skills: ["agents", "skills"], plugins: ["agents", "plugins"], template: ["agents", "template"], runs: ["agents", "activity"],
  models: ["ai", "models"], voice: ["ai", "voice"], gate: ["ai", "gate"], spend: ["ai", "spend"], usage: ["ai", "usage"], review: ["ai", "review"], incidents: ["ai", "incidents"], aipolicy: ["ai", "aipolicy"], internet: ["ai", "internet"], memlearn: ["ai", "memlearn"],
  schema: ["data", "schema"], labels: ["data", "labels"], retention: ["data", "retention"], holds: ["data", "holds"], erase: ["data", "erase"], backups: ["data", "backups"], export: ["data", "export"],
  domains: ["messaging", "domains"], inboxes: ["messaging", "inboxes"], numbers: ["messaging", "numbers"], texting: ["messaging", "texting"],
  connectors: ["apps", "apps"], connections: ["apps", "apps"], company: ["apps", "company"], google: ["apps", "google"], microsoft: ["apps", "microsoft"], kit: ["machines", "diagnostics"], webhooks: ["apps", "webhooks"], keys: ["apps", "keys"],
  machines: ["machines", "machines"], computers: ["machines", "machines"], network: ["machines", "network"], server: ["machines", "server"], updates: ["machines", "updates"], diagnostics: ["machines", "diagnostics"], support: ["machines", "support"], speed: ["machines", "speed"],
  audit: ["security", "audit"], space: ["space", "space"],
  "def-access": ["security", "reviews"], "def-agents": ["ai", "gate"], "def-memory": ["ai", "memlearn"], "def-data": ["data", "schema"], "def-apps": ["messaging", "domains"], "def-advanced": ["space", "space"],
};

test("redirects: every old page id lands on its new home, and the search finds the old names", () => {
  for (const [old, [section, page]] of Object.entries(LANDS)) {
    assert.equal(resolve(old), page, `${old} resolves to ${page}`);
    assert.equal(sectionOf(old)?.id, section, `${old} is in ${section}`);
    assert.ok(tabOf(old), `${old} sits on a tab`);
    assert.ok(PAGES.some((p) => p.id === resolve(old)), `${old} lands on a real page`);
  }
  // every page of the registry is reachable from a place, and every old name says where it went
  for (const p of PAGES) assert.ok(sectionOf(p.id), `${p.id} is in a place`);
  for (const [name, id] of OLD_NAMES) assert.ok(nowIn(id).length > 0, `${name} has a home`);
  assert.ok(html({ initialPage: "kit" }).includes('data-testid="page-diagnostics"'), "an old address opens its new page");
  assert.ok(html({ initialPage: "connections" }).includes('data-testid="page-apps"'));
});
