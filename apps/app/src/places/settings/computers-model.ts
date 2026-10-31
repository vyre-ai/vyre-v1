// Computers in Settings: the machines a person has (this computer and the servers they added), the one command that brings a server in, and the steps of the Add a server sheet.
// Pure functions over what `computers.hosts` and `network.my_computers` answer, so the page and the tests agree.

export interface HostInfo { hostId: string; kind: "this" | "space" | "server"; name: string; online: boolean; canRun: boolean; runs: number; reason?: string }
export interface ServerInfo {
  serverId: string; name: string; state: "healthy" | "degraded" | "down"; enrollment: "pending" | "approved"; fingerprint?: string; lastSeenAt?: number; requestedAt?: number;
  facts?: { os: string; arch: string; docker: boolean; version: string };
}

const OS: Record<string, string> = { linux: "Linux", darwin: "Mac", win32: "Windows" };

/** The one line to paste on the machine. The join code is inside and works once for ten minutes. */
export function joinCommand(address: string, code: string): string {
  return `vyred --role compute --server ${address} --join ${code}`;
}

/** What a machine runs, as short as it can be said: "Linux x64, Docker". */
export function factsLine(f: ServerInfo["facts"]): string {
  if (!f) return "";
  return `${OS[f.os] ?? f.os} ${f.arch}${f.docker ? ", Docker" : ""}`;
}

/** The note under a row: how many agent computers it holds, or why it cannot hold one. */
export function runsLine(h: Pick<HostInfo, "runs" | "canRun" | "reason">): string {
  if (h.runs > 0) return h.runs === 1 ? "1 agent computer" : `${h.runs} agent computers`;
  return h.canRun ? "" : h.reason ?? "";
}

export type Phase = "name" | "waiting" | "compare" | "done";

export interface Sheet { nickname: string; code: string | null; expiresAt: number | null; address: string | null; serverId: string | null; approved: boolean }
export const emptySheet = (): Sheet => ({ nickname: "", code: null, expiresAt: null, address: null, serverId: null, approved: false });

/**
 * Where the sheet is: naming the server, waiting for it to ask, comparing its fingerprint, or done. The server found is the one that arrived under the nickname (or, with none, the only
 * waiting one) after the code was made.
 */
export function phaseOf(sheet: Sheet, mine: readonly ServerInfo[]): { phase: Phase; arrived: ServerInfo | null } {
  if (sheet.code === null) return { phase: "name", arrived: null };
  const named = mine.filter((s) => s.enrollment === "pending" && (sheet.nickname === "" || s.name === sheet.nickname));
  const arrived = named[0] ?? null;
  if (sheet.approved) return { phase: "done", arrived: mine.find((s) => s.serverId === sheet.serverId) ?? arrived };
  return arrived ? { phase: "compare", arrived } : { phase: "waiting", arrived: null };
}

/** A nickname is a short word or two: letters, digits, dashes and spaces. */
export const validNickname = (s: string): boolean => /^[A-Za-z0-9][A-Za-z0-9 _-]{0,39}$/.test(s.trim());
