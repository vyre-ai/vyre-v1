// What the right column shows: the real state a step has set up so far, read from the Space. Nothing is invented: an empty answer is "Not yet" with a one-line hint of what will appear.
import { isAssistantRow } from "../../../../lib/agent-kind.ts";
import type { CapCall } from "../shell/session/caps.ts";
import type { CardKind } from "./flow.ts";
import { folderPathOf, tildePath } from "./folders-model.ts";

export interface PreviewItem { id: string; label: string; note?: string }
export interface Preview { heading: string; items: PreviewItem[]; /** shown when there are no items; empty hides the preview until there is something to show */ hint: string }

const SOURCE: Record<string, string> = { google_drive: "Google Drive", sharepoint: "SharePoint", onedrive: "OneDrive", dropbox: "Dropbox", github: "GitHub", local: "On this computer" };

const safe = async <T>(f: () => Promise<T>, empty: T): Promise<T> => { try { return await f(); } catch { return empty; } };

interface AccountOut { ref: string; providerId?: string; name?: string; title: string; kind: string; mine: boolean; base?: string; keyless?: boolean }
const accountLine = (a: AccountOut): string => `${a.name ?? a.title} · ${a.kind === "subscription" ? "subscription" : a.base !== undefined || a.keyless === true ? "local model" : "API key"} · in your Vault`;
const accountsOf = (call: CapCall) => safe(async () => (await call("engine.accounts.list", {})) as { accounts: AccountOut[] }, { accounts: [] as AccountOut[] });

export async function previewFor(call: CapCall, card: CardKind): Promise<Preview> {
  switch (card) {
    case "space_ai": {
      // the Space's key for everyone first, then the owner's own accounts here; never an id
      const k = await safe(async () => (await call("providers.space_key.get", {})) as { set: boolean; name?: string }, { set: false });
      const r = await accountsOf(call);
      return { heading: "AI for the Space", items: [...(k.set ? [{ id: "space-key", label: `${k.name ?? "A key"} for everyone`, note: "Space AI key" }] : []), ...r.accounts.map((a) => ({ id: a.providerId ?? a.ref, label: accountLine(a), note: "Yours" }))], hint: "Not yet. A key for everyone, or your own account, shows here." };
    }
    case "connect_ai": {
      const r = await accountsOf(call);
      return { heading: "Your AI account", items: r.accounts.map((a) => ({ id: a.providerId ?? a.ref, label: accountLine(a) })), hint: "Not yet. Connect an account and it shows here, kept in your Vault." };
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
      const r = await safe(async () => (await call("agents.list", { limit: 100 })) as { agents: { agentId: string; name: string; kind?: string; role?: string }[] }, { agents: [] });
      return { heading: "Agents", items: r.agents.filter((a) => !isAssistantRow(a)).map((a) => ({ id: a.agentId, label: a.name, ...(a.role ? { note: a.role } : {}) })), hint: "Not yet. The agents your Kit brings appear here." };
    }
    case "org": {
      const r = await safe(async () => (await call("kits.list", { limit: 50 })) as { kits: { kitId: string; title: string; installed: boolean }[] }, { kits: [] });
      return { heading: "Kit", items: r.kits.filter((k) => k.installed).map((k) => ({ id: k.kitId, label: k.title, note: "installed" })), hint: "Not yet. The Kit you pick for your kind of work shows here." };
    }
    case "local_folders": {
      // the folders on this computer, each with where it is ("~/Claude/Orgs/Vyre") when this run added it; nothing shows until one is added
      const r = await safe(async () => (await call("mounts.list", { kind: "local" })) as { mounts: { mountId: string; name: string; kind: string }[] }, { mounts: [] });
      return { heading: "Your folders", items: r.mounts.filter((m) => m.kind === "local").map((m) => { const path = folderPathOf(m.mountId); return { id: m.mountId, label: m.name, note: path ? tildePath(path) : SOURCE["local"]! }; }), hint: "" };
    }
    case "shared_data": {
      const r = await safe(async () => (await call("mounts.list", {})) as { mounts: { mountId: string; name: string; kind: string }[] }, { mounts: [] });
      return { heading: "Shared folders", items: r.mounts.filter((m) => m.kind !== "local").map((m) => ({ id: m.mountId, label: m.name, note: SOURCE[m.kind] ?? m.kind })), hint: "Not yet. Folders you connect appear here." };
    }
    default:
      return { heading: "Preview", items: [], hint: "Not yet. What this step sets up appears here." };
  }
}
