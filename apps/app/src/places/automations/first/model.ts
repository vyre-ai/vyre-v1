// The first page of Automations (owner, 13 Nov 2026, design 2.3): what needs him, at most one suggestion he can finish with one approval, one Today line.
// Pure: the screen reads the server, hands the rows here, and draws what comes back. Nothing here explains the interface.

export interface NeedIn {
  id: string;
  automation: string;
  /** The reason in plain words, from the server. */
  why: string;
  at: number;
  runId?: string;
  /** The app the card wears the mark of. */
  app?: string;
  fix: { label: string; kind: "key" | "approve" | "allow" | "choose" | "connect" | "see" };
  /** Also in his Inbox. */
  inbox?: boolean;
}

export interface SuggestionIn {
  id: string;
  app: { id: string; name: string };
  /** The Vault item the app would be made from, by the name he gave it. */
  item: string;
  /** He holds Use on the item (not view only). */
  mayUse: boolean;
  /** Automations has a way to connect it: a known service, or one described through the open contract. */
  knownService: boolean;
  /** cleared: the Assistant may already use it. owner: he may clear it with one tap. admin: only an admin may. */
  assistant: "cleared" | "owner" | "admin";
  dismissed?: boolean;
}

export interface TodayIn {
  ran: number;
  failed: readonly { runId: string }[];
}

export interface NeedCard extends NeedIn {}

export interface Suggestion {
  id: string;
  app: { id: string; name: string };
  title: string;
  quiet: string;
  action: string;
  dismiss: string;
  /** allow: Set up opens Ask Vyre with the one Allow card first. none: the Assistant just does it. */
  approval: "none" | "allow";
}

export type TodayPart = { t: "text"; v: string } | { t: "link"; v: string; runId: string };

export interface FirstPage {
  needs: NeedCard[];
  suggestion: Suggestion | null;
  today: { head: "Today"; parts: TodayPart[]; failedRunId?: string };
}

/** A suggestion is shown only when he can finish it with a single approval: never one that needs an admin, one he may only view, or one nobody can connect. */
export function finishable(s: SuggestionIn): boolean {
  return !s.dismissed && s.mayUse && s.knownService && s.assistant !== "admin";
}

export function firstPage(i: {
  needs: readonly NeedIn[];
  suggestions: readonly SuggestionIn[];
  today: TodayIn;
}): FirstPage {
  const seen = new Set<string>();
  const needs: NeedCard[] = [];
  for (const n of [...i.needs].sort((a, b) => b.at - a.at)) {
    // the same thing is never listed twice: one card per Automation and reason
    const key = `${n.automation}\u0000${n.why}`;
    if (seen.has(key) || seen.has(n.id)) continue;
    seen.add(key);
    seen.add(n.id);
    needs.push(n);
  }
  const pick = i.suggestions.find(finishable);
  const suggestion: Suggestion | null = pick
    ? {
        id: pick.id,
        app: pick.app,
        title: `Connect ${pick.app.name}`,
        quiet: pick.item,
        action: "Set up",
        dismiss: "Not now",
        approval: pick.assistant === "owner" ? "allow" : "none",
      }
    : null;
  const failed = i.today.failed;
  const parts: TodayPart[] = [];
  if (i.today.ran === 0 && failed.length === 0) parts.push({ t: "text", v: "Nothing ran today." });
  else {
    parts.push({ t: "text", v: `${i.today.ran} ran` });
    if (failed.length > 0) {
      parts.push({ t: "text", v: ", " });
      parts.push({ t: "link", v: `${failed.length} failed`, runId: failed[0]!.runId });
    }
    parts.push({ t: "text", v: needs.length > 0 ? ". The rest is on track." : ". Everything is on track." });
  }
  return { needs, suggestion, today: { head: "Today", parts, ...(failed[0] ? { failedRunId: failed[0].runId } : {}) } };
}
