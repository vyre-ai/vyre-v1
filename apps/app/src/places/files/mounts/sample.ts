// The sample Space behind the mount sheet tests and screenshots (Northwind, the same people and folders the prototype's Files uses): a Google Drive, a SharePoint and OneDrive tree,
// folders on this computer, a list of GitHub repositories, five folders already mounted. `call` answers mounts.browse, mounts.list, mounts.add, mounts.remove and access.share
// from memory, so every control in the sheets works the way it will against the kernel.
import type { MountsData } from "./data.tsx";
import type { Accounts, MountKind, MountRow, Person } from "./model.ts";

interface Node { ref: string; name: string; meta?: string; kids?: Node[] }

const dir = (base: string, names: string[]): Node[] => names.map((n) => ({ ref: `${base}/${n}`, name: n }));
const GOOGLE: Node[] = [
  { ref: "gd:Marketing", name: "Marketing", meta: "Shared drive" },
  { ref: "gd:Sales", name: "Sales", meta: "Shared drive" },
  { ref: "gd:Operations", name: "Operations", meta: "Shared drive" },
  { ref: "gd:Finance", name: "Finance", meta: "Shared drive" },
  { ref: "gd:My Drive", name: "My Drive", meta: "irfad@northwind.example", kids: [
    { ref: "gd:My Drive/Client intake", name: "Client intake", kids: dir("gd:My Drive/Client intake", ["Forms", "Templates"]) },
    { ref: "gd:My Drive/Board decks", name: "Board decks" },
    { ref: "gd:My Drive/Receipts 2026", name: "Receipts 2026" },
  ] },
];
const SHAREPOINT: Node[] = [
  { ref: "sp:Contracts", name: "Contracts", meta: "SharePoint · Legal" },
  { ref: "sp:HR Policies", name: "HR Policies", meta: "SharePoint · People" },
  { ref: "sp:Proposals", name: "Proposals", meta: "SharePoint · Sales" },
  { ref: "sp:Finance Reports", name: "Finance Reports", meta: "SharePoint · Finance" },
];
const ONEDRIVE: Node[] = [
  { ref: "od:OneDrive", name: "OneDrive", meta: "irfad@northwind.example", kids: [
    { ref: "od:OneDrive/Documents", name: "Documents", kids: dir("od:OneDrive/Documents", ["Drafts", "Signed"]) },
    { ref: "od:OneDrive/Desktop", name: "Desktop" },
    { ref: "od:OneDrive/Shared with me", name: "Shared with me" },
  ] },
];
const LOCAL: Node[] = [
  { ref: "~/Desktop", name: "Desktop" },
  { ref: "~/Documents", name: "Documents", kids: dir("~/Documents", ["Taxes", "Scans"]) },
  { ref: "~/Downloads", name: "Downloads" },
  { ref: "~/Projects", name: "Projects", kids: dir("~/Projects", ["vyre-site", "notes", "scripts"]) },
  { ref: "~/Developer", name: "Developer", kids: dir("~/Developer", ["northwind-tools", "experiments"]) },
];
export const REPOS: ReadonlyArray<readonly [string, string, string]> = [
  ["vyre-ai/website", "Private · TypeScript", "2 h ago"],
  ["vyre-ai/vyre", "Private · TypeScript", "Today"],
  ["vyre-ai/docs", "Public · Markdown", "3 days ago"],
  ["northwind/intake-api", "Private · Python", "Yesterday"],
  ["northwind/billing-scripts", "Private · Python", "Oct 12"],
  ["northwind/forms", "Private · TypeScript", "Oct 9"],
  ["irfad7/dotfiles", "Public · Shell", "Oct 2"],
];

const TREES: Partial<Record<MountKind, Node[]>> = { google_drive: GOOGLE, sharepoint: SHAREPOINT, onedrive: ONEDRIVE, local: LOCAL };

function find(nodes: readonly Node[], ref: string): Node | undefined {
  for (const n of nodes) {
    if (n.ref === ref) return n;
    const hit = n.kids ? find(n.kids, ref) : undefined;
    if (hit) return hit;
  }
  return undefined;
}

const PROVIDER: Record<MountKind, string> = { google_drive: "Google Drive", sharepoint: "SharePoint", onedrive: "OneDrive", local: "This computer", github: "GitHub" };

export const northwindAccounts: Accounts = {
  google_drive: { label: "irfad@northwind.example", connected: true, connectionId: "con_google" },
  microsoft: { label: "irfad@northwind.example", connected: true, connectionId: "con_ms" },
  local: { label: "Irfad's MacBook", connected: true, deviceId: "dev_macbook" },
  github: { label: "irfad7", connected: true, connectionId: "con_github" },
};

export const northwindPeople: Person[] = [
  { id: "usr_maya", name: "Maya Chen" }, { id: "usr_omar", name: "Omar Haddad" }, { id: "usr_lena", name: "Lena Ortiz" }, { id: "usr_sam", name: "Sam Patel" },
];

export const northwindFolders = [
  { id: "fld_github", name: "GitHub" }, { id: "fld_all", name: "All files" }, { id: "fld_projects", name: "Projects" }, { id: "fld_personal", name: "Personal" }, { id: "fld_channels", name: "Channels" },
] as const;

const mountRow = (id: string, kind: MountKind, name: string, ref: string, o: Partial<MountRow> = {}): MountRow => ({
  mountId: `mnt_${id}`, folderId: `fld_m_${id}`, kind, provider: PROVIDER[kind], ref, name, state: "idle", mode: "server_copy", reviewChanges: kind !== "local", pendingChanges: 0, conflicts: 0, ...o,
});

export const northwindMounts: MountRow[] = [
  mountRow("mk", "google_drive", "Marketing", "gd:Marketing"),
  mountRow("ct", "sharepoint", "Contracts", "sp:Contracts"),
  mountRow("ip", "local", "Irfad's Projects", "~/Projects", { fromDevice: "Irfad's MacBook" }),
  mountRow("web", "github", "website", "vyre-ai/website"),
  mountRow("api", "github", "intake-api", "northwind/intake-api"),
];

export interface SampleMounts {
  data: MountsData;
  /** every capability call made, in order */
  calls: { cap: string; input: unknown }[];
  mounts(): MountRow[];
  /** the next call to `cap` rejects with this error code */
  failNext(cap: string, code: string): void;
  /** sources the person pressed Connect on */
  connected: SourceIdLog;
}
type SourceIdLog = string[];

export function createSampleMounts(o: { accounts?: Accounts; everyone?: boolean; mounts?: MountRow[] } = {}): SampleMounts {
  const mounts = (o.mounts ?? northwindMounts).map((m) => ({ ...m }));
  const calls: { cap: string; input: unknown }[] = [];
  const failing = new Map<string, string>();
  const connected: SourceIdLog = [];
  let seq = 0;

  const browse = (input: { kind: MountKind; parent?: string; q?: string }) => {
    const q = (input.q ?? "").toLowerCase();
    if (input.kind === "github") {
      const rows = REPOS.filter((r) => r[0].toLowerCase().includes(q));
      return { items: rows.map((r) => ({ ref: r[0], name: r[0], isFolder: false, path: `${r[1]} · ${r[2]}` })) };
    }
    const tree = TREES[input.kind] ?? [];
    const level = input.parent === undefined ? tree : find(tree, input.parent)?.kids ?? [];
    return { items: level.filter((n) => n.name.toLowerCase().includes(q)).map((n) => ({ ref: n.ref, name: n.name, isFolder: true, ...(n.meta ? { path: n.meta } : {}) })) };
  };

  const writes: Record<string, (i: any) => unknown> = {
    "mounts.browse": browse,
    "mounts.list": () => ({ mounts: mounts.map((m) => ({ ...m })) }),
    "mounts.add": (i: { into: string; source: { kind: MountKind; ref?: string; localPath?: string; branch?: string }; name?: string; mode?: "server_copy" | "live_only"; reviewChanges?: boolean }) => {
      const ref = i.source.ref ?? i.source.localPath ?? "";
      if (mounts.some((m) => m.kind === i.source.kind && m.ref === ref)) throw Object.assign(new Error("validation.duplicate"), { code: "validation.duplicate" });
      const id = `new${++seq}`;
      mounts.push(mountRow(id, i.source.kind, i.name ?? ref, ref, { state: "syncing", mode: i.mode ?? "server_copy", reviewChanges: i.reviewChanges ?? true }));
      return { mountId: `mnt_${id}`, folderId: `fld_m_${id}`, runId: `run_${id}` };
    },
    "mounts.remove": (i: { mountId: string }) => {
      const at = mounts.findIndex((m) => m.mountId === i.mountId);
      if (at < 0) return { removed: false };
      mounts.splice(at, 1);
      return { removed: true };
    },
    "access.share": () => ({ grant: { grantId: `gnt_${++seq}` } }),
  };

  const data: MountsData = {
    async call(cap, input) {
      calls.push({ cap, input });
      const code = failing.get(cap);
      if (code) { failing.delete(cap); throw Object.assign(new Error(code), { code }); }
      const w = writes[cap];
      if (!w) throw new Error(`no answer for ${cap}`);
      return w(input);
    },
    space: { name: "Northwind", ...(o.everyone === false ? {} : { everyoneGroupId: "grp_everyone" }) },
    accounts: o.accounts ?? northwindAccounts,
    folders: northwindFolders,
    people: northwindPeople,
    connect: (s) => void connected.push(s),
  };
  return { data, calls, mounts: () => mounts.map((m) => ({ ...m })), failNext: (cap, code) => void failing.set(cap, code), connected };
}
