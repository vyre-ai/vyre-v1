// Finding F35: an item kept where an agent cannot use it. Sharing never lifts a label, so the Vault says so before a person tries: the share sheet lists the agents but cannot pick them, the item page puts one line under an agent
// whose share cannot work, and Move offers the folders an agent can use (the others are shown, not choosable). Every answer is access.clears, the one shared check; nothing here works a clearance out.
import { useEffect, useState } from "react";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";

export const AGENTS_CANT_USE_LINE = "Agents can't use Restricted items.";
export const CANT_USE_NOTE = "Can't use this while it's Restricted";
export const BARRED_FOLDER_REASON = "Agents can't use items kept here";

type Call = (cap: string, input: unknown) => Promise<unknown>;
export interface Subject {
  kind: string;
  id: string;
}
export interface FolderChoice {
  id: string;
  name: string;
  scope: "mine" | "shared";
}

/** Ask access.clears for one principal and one thing. A question that cannot be answered reads as yes: the server refuses again where it cannot work, and the screen never says no on a guess. */
export async function clears(call: Call, principal: Subject, target: { type: string; id: string }): Promise<boolean> {
  try {
    const got = (await call("access.clears", { principal, target })) as { clears?: unknown } | null;
    return got?.clears !== false;
  } catch {
    return true;
  }
}

/** Which of these agents cannot use the item where it is kept. Agents only: a person keeps their own access, and the server's Automations run as the Space. */
export async function agentsThatCannot(
  call: Call,
  item: { type: string; id: string },
  agents: readonly Subject[],
): Promise<Set<string>> {
  const out = new Set<string>();
  const unique = [...new Map(agents.filter((a) => a.kind === "agent").map((a) => [a.id, a])).values()];
  await Promise.all(
    unique.map(async (a) => {
      if (!(await clears(call, a, item))) out.add(a.id);
    }),
  );
  return out;
}

/** The folders an item can move to: Mine, then the shared folders every named agent can use, then (not choosable) the shared folders one of them cannot. Where it already is is left out. */
export async function moveChoices(
  call: Call,
  folders: readonly FolderChoice[],
  agents: readonly Subject[],
  from: string,
): Promise<{ usable: FolderChoice[]; barred: FolderChoice[] }> {
  const usable: FolderChoice[] = [];
  const barred: FolderChoice[] = [];
  await Promise.all(
    folders
      .filter((f) => f.id !== from)
      .map(async (f) => {
        if (f.scope === "mine") return void usable.push(f);
        const each = await Promise.all(agents.map((a) => clears(call, a, { type: "vault_folder", id: f.id })));
        (each.every(Boolean) ? usable : barred).push(f);
      }),
  );
  const byName = (a: FolderChoice, b: FolderChoice): number =>
    a.scope === b.scope ? a.name.localeCompare(b.name) : a.scope === "mine" ? -1 : 1;
  return { usable: usable.sort(byName), barred: barred.sort(byName) };
}

/** The Move menu: Mine and the folders agents can use, then a Restricted heading with the folders they cannot, shown and not choosable. */
export function moveEntries(
  choices: { usable: readonly FolderChoice[]; barred: readonly FolderChoice[] },
  pick: (folderId: string) => void,
): MenuEntry[] {
  const out: MenuEntry[] = [{ head: "Move to" }];
  for (const f of choices.usable) out.push({ label: f.scope === "mine" ? "Mine" : f.name, onSelect: () => pick(f.id) });
  if (choices.barred.length > 0) {
    out.push({ head: "Restricted" });
    for (const f of choices.barred)
      out.push({ label: f.name, disabled: true, reason: BARRED_FOLDER_REASON, hint: BARRED_FOLDER_REASON });
  }
  return out;
}

/** The agents (by id) that cannot use this item where it is kept, asked once the item and its agents are known and again when either changes. `again` is any number that changes when the item moved or its shares did. */
export function useAgentsThatCannot(
  call: Call,
  item: { type: string; id: string } | null,
  agents: readonly Subject[],
  again: number,
): ReadonlySet<string> {
  const [out, setOut] = useState<ReadonlySet<string>>(new Set());
  const key = agents
    .map((a) => `${a.kind}:${a.id}`)
    .sort()
    .join(",");
  useEffect(() => {
    if (!item || agents.length === 0) {
      setOut((cur) => (cur.size === 0 ? cur : new Set()));
      return undefined;
    }
    let live = true;
    void agentsThatCannot(call, item, agents).then((set) => {
      if (live) setOut(set);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call, item?.type, item?.id, key, again]);
  return out;
}
