// Space AI accounts (owner, 3 Nov; north star prototype/vyre-vault.html, l-vaultfix's capabilities): admins add any number of Space-paid AI keys, and say what each one pays for. Pure: the
// "Used for" line of a row, and the uses object the sheet saves (providers.uses.set { providerId, uses, capCents }).

/** What one Space AI account pays for (providers.list row `uses`). */
export interface Uses {
  teamChats?: { who: "everyone" | string[] };
  automations?: true;
  goals?: true;
  agentWork?: { which: "all" | string[] };
}

/** A name for an id (a group or an agent), for the line. */
export type NameOf = (id: string) => string;

const joinNames = (a: readonly string[]): string => (a.length <= 2 ? a.join(" and ") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`);

/** The row's plain line: "Used for Team chats for Operations · Automations · up to $500 a month", or that it pays for nothing yet. */
export function usedForLine(uses: Uses | undefined, capCents: number | null | undefined, nameOf: NameOf): string {
  const u: string[] = [];
  if (uses?.teamChats) u.push(uses.teamChats.who === "everyone" || uses.teamChats.who.length === 0 ? "Team chats" : `Team chats for ${joinNames(uses.teamChats.who.map(nameOf))}`);
  if (uses?.automations) u.push("Automations");
  if (uses?.goals) u.push("Goals");
  if (uses?.agentWork) u.push(uses.agentWork.which === "all" || uses.agentWork.which.length === 0 ? "Agents' own work" : `Agents' own work: ${joinNames(uses.agentWork.which.map(nameOf))}`);
  if (u.length === 0) return "Not used for anything yet";
  return `Used for ${u.join(" · ")}${typeof capCents === "number" ? ` · up to $${Math.round(capCents / 100)} a month` : ""}`;
}

/** The sheet's form: four ticks, who and which, and the cap as typed (dollars, empty for none). */
export interface UsesForm { teamChats: boolean; who: string[]; automations: boolean; goals: boolean; agentWork: boolean; which: string[]; cap: string }

export function formOf(uses: Uses | undefined, capCents: number | null | undefined): UsesForm {
  return {
    teamChats: Boolean(uses?.teamChats), who: uses?.teamChats && uses.teamChats.who !== "everyone" ? [...uses.teamChats.who] : [],
    automations: uses?.automations === true, goals: uses?.goals === true,
    agentWork: Boolean(uses?.agentWork), which: uses?.agentWork && uses.agentWork.which !== "all" ? [...uses.agentWork.which] : [],
    cap: typeof capCents === "number" ? String(Math.round(capCents / 100)) : "",
  };
}

/** What providers.uses.set takes from the form. An empty "who" is everyone, an empty "which" is all agents; an empty cap removes it. Null: the cap is not a whole number of dollars. */
export function usesOf(f: UsesForm): { uses: Uses; capCents: number | null } | null {
  const cap = f.cap.trim().replace(/^\$/, "");
  if (cap !== "" && !/^\d{1,7}$/.test(cap)) return null;
  const uses: Uses = {};
  if (f.teamChats) uses.teamChats = { who: f.who.length ? [...f.who] : "everyone" };
  if (f.automations) uses.automations = true;
  if (f.goals) uses.goals = true;
  if (f.agentWork) uses.agentWork = { which: f.which.length ? [...f.which] : "all" };
  return { uses, capCents: cap === "" ? null : Number(cap) * 100 };
}
