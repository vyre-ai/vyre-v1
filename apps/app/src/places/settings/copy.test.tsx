// The words rules of team/v1/SETTINGS-CONSOLE-IA.md over every Settings page: no banned word in anything a person reads, and none of the "never" words.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsDataProvider } from "./data.tsx";
import { SettingsPlace } from "./SettingsPlace.tsx";
import { PAGES } from "./model.ts";
import { createSampleSettings, northwind } from "./sample.ts";

const BANNED = ["principal", "grant", "grants", "actor", "actors", "schema", "gate", "suppression", "retention", "provider matrix", "label grid", "tenant", "scope", "policy object", "capability", "sandbox.denied", "trace", "company only", "by label"];
const text = (h: string): string => h.replace(/<[^>]+>/g, " ").replaceAll("&#x27;", "'").replaceAll("&amp;", "&").replace(/\s+/g, " ");

test("no banned word and no never-word on the seven pages and the two moved ones", () => {
  const bad: string[] = [];
  for (const p of PAGES.filter((x) => x.group === "you" && (x.hidden !== true || x.key === "connected" || x.key === "mail"))) {
    const s = createSampleSettings(northwind);
    const out = text(renderToStaticMarkup(<SettingsDataProvider value={s.data}><SettingsPlace width={1280} initialPage={p.key} /></SettingsDataProvider>)).toLowerCase();
    for (const w of BANNED) if (new RegExp(`(^|[^a-z])${w.replace(".", "\\.")}([^a-z]|$)`).test(out)) bad.push(`${p.key}: ${w}`);
    for (const [re, name] of [[/!/, "exclamation mark"], [/—/, "em dash"], [/successfully/, "successfully"]] as const) if (re.test(out)) bad.push(`${p.key}: ${name}`);
  }
  assert.deepEqual(bad, []);
});
