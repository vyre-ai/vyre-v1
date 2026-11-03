// Mount for lane l-aipick (owner, 3 Nov): the "AI account" choice on a new agent and on an automation's Settings, over scripted Space AI accounts (the same rows the Vault's Space tab shows).
//   ?part=agent (the agent page, scrolled to AI account), agent-menu (its picker open), settings (a Space automation's Settings, scrolled to AI account), settings-menu (the main picker open),
//   settings-set (Main and Backup chosen), agent-set (an account chosen on the agent)
// The query is read after mount (rule 25), so the first frame is empty and the client draws the same one.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { AgentForm } from "../../../apps/app/src/places/chats/agentform/AgentForm.tsx";
import { AutomationsDataProvider } from "../../../apps/app/src/places/automations/canvas/data.tsx";
import { AutomationConfig } from "../../../apps/app/src/places/automations/config/AutomationConfig.tsx";
import { ConfigExtrasProvider } from "../../../apps/app/src/places/automations/config/data.tsx";
import { createConfigSample, northwind } from "../../../apps/app/src/places/automations/config/sample.ts";

export const title = "AI account on an agent and on an automation";

const ROWS = [
  { id: "prv_a", name: "Anthropic API · Team credits", providerKey: "anthropic", scope: "shared", handle: "#Team_Credits", state: "ok", capCents: 50000, uses: { automations: true, goals: true, agentWork: { which: "all" } } },
  { id: "prv_o", name: "OpenCode Go · Team key", providerKey: "opencode-go", scope: "shared", handle: "#OpenCode_Team", state: "ok", uses: { teamChats: { who: "everyone" } } },
  { id: "prv_r", name: "OpenRouter", providerKey: "openrouter", scope: "shared", handle: "#OpenRouter", state: "ok", uses: { automations: true, agentWork: { which: "all" } } },
  { id: "prv_m", name: "Your Claude sign-in", providerKey: "claude-code", scope: "mine", handle: "#My_Claude", state: "ok" },
];

function scroll(id: string, hold: string | null): void {
  const doc = (globalThis as { document?: { querySelector(s: string): { scrollIntoView(o: unknown): void } | null } }).document;
  const go = (): void => { doc?.querySelector(`[data-testid='${id}']`)?.scrollIntoView({ block: hold ?? "center" }); };
  setTimeout(go, 0);
}

export default function Mount(): ReactNode {
  const [part, setPart] = useState<string | null>(null);
  useEffect(() => setPart(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("part") ?? "agent"), []);
  const sample = useMemo(() => createConfigSample(northwind), []);
  const height = useWindowDimensions().height;
  const call = useMemo(() => {
    const base = sample.data.call;
    return async (cap: string, input: unknown): Promise<unknown> => {
      if (cap === "providers.list") return { providers: part === "agent-none" ? ROWS.filter((r) => r.scope === "mine" || r.id === "prv_o") : ROWS };
      if (cap === "providers.space_key.get") return { mayManage: part !== "agent-member" };
      if (cap === "vault.items.list") return { items: [] };
      if (cap === "engine.models.list") return { models: [{ model: "claude-opus-5-5", title: "Opus 5.5", allowed: true }, { model: "claude-sonnet-5-5", title: "Sonnet 5.5", allowed: true }] };
      if (cap === "access.shares_of") return { shares: [] };
      if (cap === "files.list") return { files: [], folders: [] };
      if (cap === "agents.get") return { agent: { agentId: "agt_intake", name: "Intake", role: "Answers new enquiries and books the consult", face: "pick-intake", model: "claude-sonnet-5-5", folderId: "fld_intake", workKey: "#Team_Credits", status: "awake", accountPolicy: part === "agent-chatkey" ? "key" : "asker", ...(part === "agent-chatkey" ? { accountKey: "#OpenCode_Team" } : {}), accountFallback: [] } };
      if (part?.startsWith("settings")) return base(cap, input);
      return {};
    };
  }, [sample, part]);
  const data = useMemo(() => ({ ...sample.data, call }), [sample, call]);
  useEffect(() => {
    if (part !== "settings-set") return;
    const row = sample.replica.rows("automations").find((r) => r.id === "aut_lead");
    const def = row?.["definition"] as { ai?: unknown } | undefined;
    if (def) void sample.data.call("automations.update", { automationId: "aut_lead", definition: { ...def, ai: { keyId: "#Team_Credits", backupKeyId: "#OpenRouter" } }, expectedVersion: Number(row?.["version"]) });
  }, [part, sample]);
  useEffect(() => {
    if (part === null) return;
    if (part.startsWith("agent")) scroll("agent-ai-account", "center");
    else scroll("ai-account", "center");
  }, [part]);
  if (part === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  if (part.startsWith("agent")) {
    return (
      <View style={{ height, backgroundColor: "var(--win)" as string }}>
        <AgentForm
          agentId={part === "agent-set" || part === "agent-chatkey" ? "agt_intake" : null} call={call} newKey={() => "k"} onDone={() => undefined} onCancel={() => undefined} say={() => undefined}
          openVault={() => undefined} sharing={{ directory: sample.extras.directory, meName: "Irfad Imtiaz", meId: "usr_irfad", nameOf: (id) => sample.data.name(id) }}
        />
      </View>
    );
  }
  return (
    <AutomationsDataProvider value={data}>
      <ConfigExtrasProvider value={sample.extras}>
        <View style={{ height, backgroundColor: "var(--win)" as string }}><AutomationConfig automationId="aut_lead" initialTab="settings" /></View>
      </ConfigExtrasProvider>
    </AutomationsDataProvider>
  );
}
