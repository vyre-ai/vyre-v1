// What a press does in the mount sheet: one capability call, then the answer in words. Reads never throw into a click; a failed write becomes a line under the buttons.
import type { CapMap } from "../../../../../../generated/types.ts";
import { addInput, browseInputs, mountError, shareInputs, sourceOf } from "./model.ts";
import type { Accounts, BrowseItem, Draft, MountRow } from "./model.ts";

export type Call = (cap: string, input: unknown) => Promise<unknown>;

export interface Listing { items: BrowseItem[]; next?: string }

/** The things at the current level, with the provider kind of each. A Microsoft root merges SharePoint and OneDrive. */
export async function browse(call: Call, d: Draft, accounts: Accounts, cursor?: string): Promise<Listing> {
  if (d.source === null) return { items: [] };
  const inputs = browseInputs(d, accounts[d.source], cursor);
  const items: BrowseItem[] = [];
  let nextCursor: string | undefined;
  for (const input of inputs) {
    const out = (await call("mounts.browse", input)) as CapMap["mounts.browse"]["out"];
    for (const it of out.items) items.push({ ref: it.ref, name: it.name, isFolder: it.isFolder, kind: input.kind, ...(it.path !== undefined ? { path: it.path } : {}), ...(it.shared !== undefined ? { shared: it.shared } : {}) });
    if (out.next !== undefined) nextCursor = out.next;
  }
  return { items, ...(nextCursor !== undefined ? { next: nextCursor } : {}) };
}

/** The mounts the person can already see, to mark them "Mounted". A failed read means none are marked. */
export async function mountedRows(call: Call): Promise<MountRow[]> {
  try { return ((await call("mounts.list", {})) as CapMap["mounts.list"]["out"]).mounts; } catch { return []; }
}

export type MountResult = { ok: true; mountId: string; folderId: string; runId: string; name: string; warning?: string } | { ok: false; error: string };

/** Mount, then share with the people chosen. The mount is the point: a share that fails after it leaves the mount in place and comes back as a warning. */
export async function submitMount(call: Call, d: Draft, accounts: Accounts, everyoneGroupId?: string): Promise<MountResult> {
  const input = addInput(d, accounts);
  if (input === null || d.source === null) return { ok: false, error: "Pick a folder first." };
  let out: CapMap["mounts.add"]["out"];
  try { out = (await call("mounts.add", input)) as CapMap["mounts.add"]["out"]; } catch (e) { return { ok: false, error: mountError(e, sourceOf(d.source).name) }; }
  const name = input.name ?? "";
  for (const share of shareInputs(d.who, out.folderId, everyoneGroupId)) {
    try { await call("access.share", share); } catch { return { ok: true, mountId: out.mountId, folderId: out.folderId, runId: out.runId, name, warning: `Mounted ${name}, but sharing it did not work. Open Share on the folder to try again.` }; }
  }
  return { ok: true, mountId: out.mountId, folderId: out.folderId, runId: out.runId, name };
}

export type RemoveResult = { ok: true } | { ok: false; error: string };

/** Unmount. Keeping a copy leaves the files as a plain folder in Vyre; otherwise the copy goes too. */
export async function removeMount(call: Call, mountId: string, keepCopy: boolean): Promise<RemoveResult> {
  try {
    const out = (await call("mounts.remove", { mountId, keepCopy })) as CapMap["mounts.remove"]["out"];
    return out.removed ? { ok: true } : { ok: false, error: "That mount was already gone." };
  } catch {
    return { ok: false, error: "Could not unmount that. Try again." };
  }
}

