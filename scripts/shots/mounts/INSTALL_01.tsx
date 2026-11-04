// Mount for lane l-install: the install card for each kind, the member's card (no Space), the update diff, the Skills list in the right pane (Share and History open), and Console's Installed from links.
//   ?part=skill | plugin | mcp | remote | member | done | update | skills | console
// The query is read after mount (rule 25), so the first frame is empty and the client draws the same one.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { InstallCard } from "../../../apps/app/src/places/chats/install/InstallCard.tsx";
import { SkillsTab } from "../../../apps/app/src/places/chats/install/SkillsTab.tsx";
import { InstalledFromLinks } from "../../../apps/app/src/skills/InstalledFromLinks.tsx";

export const title = "Install from a link";
const WHO = (space: boolean) => [{ key: "me", label: "Just you", allowed: true }, { key: "agent", label: "This agent", allowed: true }, { key: "space", label: "Everyone in the Space", allowed: space, adminOnly: true }];
const base = { state: "planned", skills: [] as string[], problems: [] as string[] };
const PLANS: Record<string, unknown> = {
  skill: { ...base, planId: "ins_1", kind: "skill", name: "pdf-tools", summary: "Reads, splits and fills in PDF forms for your agents.", repo: "acme/pdf-tools", commit: "a41f9c2".padEnd(40, "0"), url: "https://github.com/acme/pdf-tools", needs: { domains: ["api.example.com"], vaultKeys: [], files: [] }, who: WHO(true) },
  plugin: { ...base, planId: "ins_2", kind: "plugin", flavor: "claude", name: "review-kit", summary: "Adds a pull request review command and a review checklist skill.", repo: "acme/review-kit", commit: "3be07d1".padEnd(40, "0"), url: "https://github.com/acme/review-kit", skills: ["review-checklist"], needs: { domains: ["api.github.com"], vaultKeys: ["GitHub token (yours)"], files: ["1 skill"] }, who: WHO(true) },
  mcp: { ...base, planId: "ins_3", kind: "mcp_local", name: "sql-reader", summary: "Lets agents ask read-only questions of a database.", repo: "acme/sql-reader", commit: "c90e5a3".padEnd(40, "0"), url: "https://github.com/acme/sql-reader", needs: { domains: [], vaultKeys: ["DATABASE_URL"], files: ["A copy of the repository, in the sandbox"] }, runs: { command: "node", args: ["server.js"] }, who: WHO(true),
    runOn: [{ key: "sandbox", label: "On your computer, in the sandbox" }, { key: "space", label: "Run it on the Space", needs: "A Vault key to protect it" }] },
  remote: { ...base, planId: "ins_4", kind: "mcp_remote", name: "tasks-mcp", summary: "Lets agents read and update tasks in your task tool.", repo: "mcp.tasks.example", commit: "", url: "https://mcp.tasks.example/sse", needs: { domains: ["mcp.tasks.example"], vaultKeys: [], files: [] }, who: WHO(true) },
  update: { ...base, planId: "ins_5", kind: "skill", name: "pdf-tools", summary: "x", repo: "acme/pdf-tools", commit: "7d03be8".padEnd(40, "0"), url: "u", needs: { domains: ["api.example.com", "cdn.example.com"], vaultKeys: [], files: [] }, who: WHO(true),
    diff: { from: "a41f9c2".padEnd(40, "0"), to: "7d03be8".padEnd(40, "0"), added: ["tools.json"], removed: [], changed: [{ path: "SKILL.md", minus: ["Splits a PDF into single pages."], plus: ["Splits a PDF into single pages or page ranges.", "Fills in form fields from a record."] }] } },
};
const KEY: Record<string, string> = { skill: "skill", plugin: "plugin", mcp: "mcp", remote: "remote", member: "skill", done: "skill", update: "update" };
const INSTALLS = [
  { installId: "ins_1", kind: "skill", name: "pdf-tools", repo: "acme/pdf-tools", commit: "a41f9c2".padEnd(40, "0"), url: "u", by: "usr_dana", at: 1, installed: {} },
  { installId: "ins_3", kind: "mcp_local", name: "sql-reader", repo: "acme/sql-reader", commit: "c90e5a3".padEnd(40, "0"), url: "u", by: "usr_maya", at: 1, installed: {} },
  { installId: "ins_4", kind: "mcp_remote", name: "tasks-mcp", repo: "mcp.tasks.example", commit: "", url: "https://mcp.tasks.example/sse", by: "usr_dana", at: 1, installed: {} },
];

export default function Mount(): ReactNode {
  const [search, setSearch] = useState<string | null>(null);
  useEffect(() => setSearch((globalThis as { location?: { search?: string } }).location?.search ?? ""), []);
  const part = new URLSearchParams(search ?? "").get("part") ?? "skill";
  const call = useMemo(() => async (cap: string, input: unknown): Promise<unknown> => {
    const i = input as Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
    switch (cap) {
      case "install.get": {
        const k = KEY[part] ?? "skill";
        const plan = PLANS[k] as Record<string, unknown>;
        return { plan: part === "member" ? { ...plan, who: WHO(false) } : part === "done" ? { ...plan, state: "installed" } : plan };
      }
      case "skills.page": return { mine: [{ skillId: "sko_1", name: "pdf-tools", description: "", source: "github:acme/pdf-tools@a41f9c2", origin: "acme/pdf-tools", version: "1.2.0", agents: ["*"], enabled: true, perms: {}, setup: {}, needs: [], sharedWith: [], updatedAt: 1 }, { skillId: "sko_2", name: "Weekly report format", description: "", source: "upload", origin: "", agents: ["*"], enabled: true, perms: {}, setup: {}, needs: [], sharedWith: [], updatedAt: 1 }],
        shared: [{ skillId: "sko_9", name: "Brand voice", sharer: "usr_sara", sharerName: "Sara Malik", description: "", toSpace: false, source: "", origin: "", perms: {}, state: "added", growth: [], agents: [], enabled: true, setup: {}, needs: [], updatedAt: 1 }], waiting: [], space: [], builtin: [], agents: [{ agentId: "agt_mira", name: "Mira" }, { agentId: "agt_ember", name: "Ember" }], policy: { scriptsAdminOnly: false }, admin: false, me: "usr_irfad" };
      case "skills.of_agents": return { skills: [{ skillId: "sko_5", name: "Write a brief", description: "", agentId: "agt_mira", agentName: "Mira", version: "1.4", source: "agent", rev: 2, updatedAt: 1 }, { skillId: "sko_6", name: "Review a pull request", description: "", agentId: "agt_ember", agentName: "Ember", version: "2.0", source: "agent", rev: 3, updatedAt: 1 }] };
      case "skills.history": return { revisions: [{ rev: 2, by: "usr_irfad", authorKind: "person", summary: "Updated to 7d03be8", at: Date.UTC(2025, 10, 4) }, { rev: 1, by: "usr_irfad", authorKind: "person", summary: "Installed from a link", at: Date.UTC(2025, 9, 20) }] };
      case "skills.grants": return { owner: "usr_irfad", ownerKind: "person", grants: [{ agentId: "agt_mira", level: "use", by: "usr_irfad", at: 1 }] };
      case "install.list": return { installs: INSTALLS };
      default: void i; throw new Error(`no ${cap}`);
    }
  }, [part]);
  if (search === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  const names: Record<string, string> = { usr_dana: "Dana Ortiz", usr_maya: "Maya Chen", usr_irfad: "Irfad Imtiaz", usr_sara: "Sara Malik", agt_mira: "Mira", agt_ember: "Ember" };
  const nameOf = (id: string): string => names[id] ?? id;
  const frame = { flex: 1, backgroundColor: "var(--win)" as string };
  if (part === "skills") return <View style={frame}><View style={{ flex: 1, maxWidth: 420 }}><SkillsTab deps={{ call, note: () => undefined }} nameOf={nameOf} {...{ highlight: "pdf-tools" }} /></View></View>;
  if (part === "console") return <ScrollView style={frame} contentContainerStyle={{ padding: 24, maxWidth: 760 }}><InstalledFromLinks call={call} nameOf={nameOf} /></ScrollView>;
  const k = KEY[part] ?? "skill";
  const p = PLANS[k] as { planId: string; name: string; kind: string };
  return (
    <ScrollView style={frame} contentContainerStyle={{ padding: 24, gap: 10, maxWidth: 640 }}>
      <InstallCard id="m1" chat={{ call: call as never, agentId: "agt_mira", openSkills: () => undefined }} data={{ planId: p.planId, name: p.name, kind: p.kind, ...(part === "update" ? { update: true, installId: "ins_1" } : {}) }} />
    </ScrollView>
  );
}
