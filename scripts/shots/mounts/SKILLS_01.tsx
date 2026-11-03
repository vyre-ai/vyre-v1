// Mount for Skills in Settings and Console (lane l-skills2, owner ruling 3 Nov), over scripted answers. ?part=
//   settings       Settings > Skills in a Team Space: two cards waiting (one shared with you, one back after an update that can touch more), Mine, From your Space, Built in, Your agents
//   personal       the same page in a Personal Space, with nothing of your own yet
//   console        Console > Skills: Space-wide skills, the scripts rule, members' skills by name with Make Space-wide
// The shoot script presses buttons on top of these for the Add sheet, its review and a skill's sheet with Add to Vault.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { SettingsDataProvider } from "../../../apps/app/src/places/settings/data.tsx";
import { SettingsPlace } from "../../../apps/app/src/places/settings/SettingsPlace.tsx";
import { createSampleSettings } from "../../../apps/app/src/places/settings/sample.ts";
import { ConsoleDataProvider } from "../../../apps/app/src/console/shell/data.tsx";
import type { ConsoleData } from "../../../apps/app/src/console/shell/data.tsx";
import { createSampleConsole } from "../../../apps/app/src/console/shell/sample.ts";
import { SkillsPage } from "../../../apps/app/src/console/pages/Skills.tsx";
import { SAMPLE_MEMBERS, samplePage } from "../../../apps/app/src/skills/sample.ts";

export const title = "Skills in Settings and Console";

const PEOPLE = [{ id: "usr_irfad", name: "Irfad Imtiaz" }, { id: "usr_maya", name: "Maya Chen" }, { id: "usr_leo", name: "Leo Park" }, { id: "usr_june", name: "June Okafor" }];
const FOUND = {
  source: "github:anthropics/skills@main/document-skills", problems: [], skipped: ["document-skills/pdf/assets/logo.png"],
  skills: [
    {
      name: "pdf", description: "Fill in, read, split and merge PDF forms.", text: "---\nname: pdf\n---\n", files: { "scripts/fill_form.py": "", "scripts/merge.py": "", "reference.md": "" }, path: "pdf", source: "github:anthropics/skills@main/document-skills/pdf", kind: "skill", version: "1.4.0",
      perms: { scripts: ["scripts/fill_form.py", "scripts/merge.py"], mcpServers: [], network: [], vaultKeys: [] }, taken: "pdf (from anthropics/skills)",
    },
    { name: "docx", description: "Create and edit Word documents with tracked changes.", text: "---\nname: docx\n---\n", files: { "ooxml.md": "" }, path: "docx", source: "github:anthropics/skills@main/document-skills/docx", kind: "skill", perms: { scripts: [], mcpServers: [], network: [], vaultKeys: [] } },
  ],
};
const BROWSE = [
  { marketplaceId: "mkt_anthropic", marketplace: "anthropic-agent-skills", name: "document-skills", description: "PDF, Word, Excel and PowerPoint", version: "1.4.0", allowed: true },
  { marketplaceId: "mkt_mla", marketplace: "mla-skills", name: "intake-kit", description: "Intake forms and triage for law firms", allowed: true },
];

/** The answers the Skills page asks for; anything else goes to the sample beneath. */
function skillsCall(mode: "settings" | "personal" | "console", next: (cap: string, input: unknown) => Promise<unknown>) {
  const page = samplePage({ admin: mode === "console", empty: mode === "personal" });
  return async (cap: string, input: unknown): Promise<unknown> => {
    if (cap === "skills.page") return page;
    if (cap === "skills.members") return { skills: SAMPLE_MEMBERS };
    if (cap === "skills.preview") return FOUND;
    if (cap === "plugins.browse") return { plugins: BROWSE };
    if (cap === "access.principals.list") return { principals: PEOPLE };
    if (cap === "skills.view") return { skill: { name: "pdf", description: "", text: "---\nname: pdf\ndescription: Fill in, read and merge PDF forms.\n---\n\n# PDF\n\nUse scripts/fill_form.py to fill a form.\n", files: [{ path: "scripts/fill_form.py", bytes: 2100, text: "" }], perms: page.waiting[0]?.perms, source: "github:anthropics/skills" } };
    if (cap.startsWith("skills.") || cap === "engine.mcp.tools") return {};
    return next(cap, input);
  };
}

export default function Mount(): ReactNode {
  const [part, setPart] = useState<string | null>(null);
  useEffect(() => setPart(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("part") ?? "settings"), []);
  const team = useMemo(() => { const s = createSampleSettings(); return { ...s.data, ask: () => undefined, call: skillsCall("settings", s.data.call) }; }, []);
  const personal = useMemo(() => {
    const s = createSampleSettings();
    return { ...s.data, ask: () => undefined, call: skillsCall("personal", s.data.call), space: { id: "personal", name: "Personal" }, spaces: s.data.spaces.map((x) => ({ ...x, current: x.kind === "personal" })) };
  }, []);
  const console_ = useMemo((): ConsoleData => { const base = createSampleConsole().data; return { ...base, call: skillsCall("console", base.call) as ConsoleData["call"] }; }, []);
  if (part === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  if (part === "console") return <ConsoleDataProvider value={console_}><View style={{ flex: 1, minHeight: 860, padding: 24, backgroundColor: "var(--win)" as string }}><View style={{ maxWidth: 760, width: "100%", alignSelf: "center" }}><SkillsPage /></View></View></ConsoleDataProvider>;
  return <SettingsDataProvider value={part === "personal" ? personal : team}><View style={{ flex: 1, minHeight: 860 }}><SettingsPlace initialPage="skills" /></View></SettingsDataProvider>;
}
