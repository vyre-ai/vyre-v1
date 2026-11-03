// Console > Agents and actors > Connected MCP apps: what one outside agent row says to an owner or admin. Who connected it, whether it holds the setup grant, and when it last did anything.
import type { CapMap } from "../../../../../generated/types.ts";

export type ConnectedRow = CapMap["mcp.connected.list"]["out"]["agents"][number];

/** "3 min ago", "2 h ago", "4 d ago": the last call an outside agent made. */
export function lastActive(at: number | undefined, now: number): string {
  if (at === undefined) return "Not used yet";
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return "Active just now";
  if (s < 3600) return `Active ${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `Active ${Math.round(s / 3600)} h ago`;
  return `Active ${Math.round(s / 86_400)} d ago`;
}

/** The row's note: who connected it, its setup grant, its last activity. */
export function connectedNote(a: ConnectedRow, personName: string, now: number): string {
  return `Connected by ${personName} · ${a.setup === true ? "Acts for them, including setup" : "Asks them first"} · ${lastActive(a.lastSeenAt, now)}`;
}
