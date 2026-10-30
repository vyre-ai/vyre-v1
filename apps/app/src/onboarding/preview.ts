// What the right column shows: the real state a step has set up so far, read from the Space. Nothing is invented: an empty answer is "Not yet" with a one-line hint of what will appear.
import type { CapCall } from "../shell/session/caps.ts";
import type { CardKind } from "./flow.ts";

export interface PreviewItem { id: string; label: string; note?: string }
export interface Preview { heading: string; items: PreviewItem[]; /** shown when there are no items */ hint: string }

const safe = async <T>(f: () => Promise<T>, empty: T): Promise<T> => { try { return await f(); } catch { return empty; } };

const providerLine = (p: { name: string; connection: string; scope: string }): string => `${p.name} · ${p.connection === "subscription" ? "subscription" : p.connection === "local_model" ? "local model" : "API key"} · in your Vault`;

export async function previewFor(call: CapCall, card: CardKind): Promise<Preview> {
  switch (card) {
    case "connect_ai": case "space_ai": {
      const r = await safe(async () => (await call("providers.list", {})) as { providers: { id: string; name: string; connection: string; scope: string }[] }, { providers: [] });
      return { heading: "Your AI account", items: r.providers.map((p) => ({ id: p.id, label: providerLine(p) })), hint: "Not yet. Connect an account and it shows here, kept in your Vault." };
    }
    case "interview": {
      const r = await safe(async () => (await call("memory.facts.list", { layer: "person" })) as { facts: { factId: string; text: string; sourceRef?: string; status?: string }[] }, { facts: [] });
      return { heading: "Saved to your memory", items: r.facts.filter((f) => f.sourceRef === "onboarding" && f.status !== "removed").map((f) => ({ id: f.factId, label: f.text })), hint: "Not yet. What you tell me about how you work is saved here, and you can edit it." };
    }
    case "phone": {
      const r = await safe(async () => (await call("devices.list", {})) as { devices: { id: string; name: string; class: string; revokedAt?: number; current?: boolean }[] }, { devices: [] });
      return { heading: "Your devices", items: r.devices.filter((d) => !d.revokedAt).map((d) => ({ id: d.id, label: d.name, note: `${d.class}${d.current ? ", this one" : ""}` })), hint: "Not yet. A paired phone shows here." };
    }
    case "directory": case "invites": {
      const people = await safe(async () => (await call("access.principals.list", { kind: "person" })) as { principals: { id: string; name: string; status: string }[] }, { principals: [] });
      const inv = await safe(async () => (await call("members.invites.list", {})) as { invites: { id: string; email?: string; state: string }[] }, { invites: [] });
      return {
        heading: "Your team",
        items: [
          ...people.principals.filter((p) => p.status === "active").map((p) => ({ id: p.id, label: p.name, note: "in the Space" })),
          ...inv.invites.filter((i) => i.state === "open").map((i) => ({ id: i.id, label: i.email ?? "Invite link", note: "invited" })),
        ],
        hint: "Not yet. People you import or invite appear here.",
      };
    }
    case "agents": {
      const r = await safe(async () => (await call("agents.list", { limit: 100 })) as { agents: { agentId: string; name: string; role?: string }[] }, { agents: [] });
      return { heading: "Agents", items: r.agents.filter((a) => a.role !== "assistant").map((a) => ({ id: a.agentId, label: a.name, ...(a.role ? { note: a.role } : {}) })), hint: "Not yet. The agents your Kit brings appear here." };
    }
    case "org": {
      const r = await safe(async () => (await call("kits.list", { limit: 50 })) as { kits: { kitId: string; title: string; installed: boolean }[] }, { kits: [] });
      return { heading: "Kit", items: r.kits.filter((k) => k.installed).map((k) => ({ id: k.kitId, label: k.title, note: "installed" })), hint: "Not yet. The Kit you pick for your kind of work shows here." };
    }
    case "local_folders": case "shared_data": {
      const r = await safe(async () => (await call("mounts.list", {})) as { mounts: { mountId: string; name: string; kind: string }[] }, { mounts: [] });
      return { heading: "Folders", items: r.mounts.map((m) => ({ id: m.mountId, label: m.name, note: m.kind.replace("_", " ") })), hint: "Not yet. Folders you connect appear here." };
    }
    default:
      return { heading: "Preview", items: [], hint: "Not yet. What this step sets up appears here." };
  }
}
