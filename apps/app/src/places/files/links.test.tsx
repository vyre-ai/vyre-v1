// File references resolved (rc.8): near the file first, by path next, by name search last for [[links]]; a missing [[link]] is broken and a missing bare name stays words.
import test from "node:test";
import assert from "node:assert/strict";
import { newFileName, resolveTargets, treePath } from "./links.ts";
import { distinctRefs } from "../../../../../ui/src/Viewer/index.tsx";

const FOLDERS: Record<string, { folderId: string; parentId?: string; name: string; path: string }> = {
  fld_agent: { folderId: "fld_agent", parentId: "fld_agents", name: "Intake", path: "Agents/Intake" },
  fld_agents: { folderId: "fld_agents", parentId: "fld_top", name: "Agents", path: "Agents" },
  fld_top: { folderId: "fld_top", name: "Space", path: "" },
};
const FILES: Record<string, Array<{ fileId: string; folderId: string; name: string }>> = {
  fld_agent: [{ fileId: "fil_agent", folderId: "fld_agent", name: "AGENT.md" }, { fileId: "fil_toml", folderId: "fld_agent", name: "agent.toml" }],
  fld_agents: [],
  fld_top: [{ fileId: "fil_vyre", folderId: "fld_top", name: "VYRE.md" }, { fileId: "fil_brand", folderId: "fld_top", name: "Brand voice.md" }],
};
const call = async (cap: string, input: unknown): Promise<unknown> => {
  const i = input as Record<string, string>;
  if (cap === "files.folder.get") return { folder: FOLDERS[i["folderId"]!] };
  if (cap === "files.list") return { files: FILES[i["folder"]!] ?? [] };
  if (cap === "files.resolve") return i["path"] === "Agents/Intake/notes/plan.md" ? { kind: "file", fileId: "fil_plan" } : (() => { throw new Error("none"); })();
  if (cap === "search.query") return { hits: i["q"] === "Pricing" ? [{ kind: "file", id: "fil_pricing", title: "Pricing.md", path: "Sales/Pricing.md" }] : [] };
  throw new Error(cap);
};

test("a name is found in this file's folder, then the folders above it", async () => {
  const m = await resolveTargets(call, { folderId: "fld_agent" }, distinctRefs("Inherits: VYRE.md. Settings in agent.toml. Nothing named nothing.md."));
  assert.deepEqual(m.get("VYRE.md"), { id: "fil_vyre", name: "VYRE.md", path: "VYRE.md" });
  assert.equal(m.get("agent.toml")?.id, "fil_toml");
  assert.equal(m.get("agent.toml")?.path, "Agents/Intake/agent.toml");
  assert.equal(m.get("nothing.md"), null, "a bare name that is not a file stays words");
});

test("[[Name]] needs no extension, a relative path resolves from the folder, a name elsewhere is found by search, a missing target is null", async () => {
  const m = await resolveTargets(call, { folderId: "fld_agent" }, distinctRefs("[[Brand voice]] [plan](notes/plan.md) [[Pricing]] [[Nowhere]]"));
  assert.equal(m.get("Brand voice")?.id, "fil_brand");
  assert.equal(m.get("notes/plan.md")?.id, "fil_plan");
  assert.equal(m.get("Pricing")?.id, "fil_pricing");
  assert.equal(m.get("Nowhere"), null);
});

test("relative paths follow .. and a created file keeps its extension", () => {
  assert.equal(treePath("Agents/Intake", "../VYRE.md"), "Agents/VYRE.md");
  assert.equal(treePath("Agents/Intake", "./notes/plan.md"), "Agents/Intake/notes/plan.md");
  assert.equal(newFileName("Brand voice"), "Brand voice.md");
  assert.equal(newFileName("notes/agent.toml"), "agent.toml");
});

test("the Inherits chip opens VYRE.md from near the file, in a tab or behind it", async () => {
  const { openByName } = await import("./links.ts");
  const opened: Array<[string, boolean]> = [];
  const d = { call, openFileTab: (id: string, bg: boolean) => opened.push([id, bg]) };
  assert.equal(await openByName(d, "fld_agent", "VYRE.md"), true);
  assert.equal(await openByName(d, "fld_agent", "VYRE.md", true), true);
  assert.equal(await openByName(d, "fld_agent", "NOPE.md"), false);
  assert.deepEqual(opened, [["fil_vyre", false], ["fil_vyre", true]]);
});
