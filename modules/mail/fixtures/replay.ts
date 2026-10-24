// Recorded IMAP sessions for the connector replay tests. CI never opens a socket (spec brief: replay tests only).
// A script is the recorded conversation with one server: whether LOGIN and NOOP worked, the folder epoch, the messages already in the
// folders, and the batches that arrive while the client sits in IDLE. The session follows the ImapSession seam of handlers/ingest.ts.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ImapConfig, ImapMessage, ImapSession, ImapSessionFactory } from "../handlers/ingest.ts";

export type ReplayMessage = Omit<ImapMessage, "folder"> & { folder?: string };

export interface ReplayScript {
  login?: boolean;
  noop?: boolean;
  uidValidity?: number;
  messages?: ReplayMessage[];
  /** each step is one wake-up: the messages arrive, then the client is told */
  idle?: { arrive: ReplayMessage[] }[];
}

const withFolder = (m: ReplayMessage): ImapMessage => ({ ...m, folder: m.folder ?? "INBOX" });

export function sessionFromScript(script: ReplayScript): ImapSession & { calls: string[] } {
  const present: ImapMessage[] = (script.messages ?? []).map(withFolder);
  const calls: string[] = [];
  return {
    calls,
    async connect() {
      calls.push("connect");
      if (script.login === false) throw new Error("LOGIN failed");
      return { uidValidity: script.uidValidity ?? 1 };
    },
    async noop() {
      calls.push("noop");
      if (script.noop === false) throw new Error("NOOP failed");
    },
    async fetchAfter(uids) {
      calls.push("fetchAfter");
      return present.filter((m) => m.uid > (uids[m.folder] ?? 0));
    },
    async idle(onExists) {
      calls.push("idle");
      for (const step of script.idle ?? []) {
        present.push(...step.arrive.map(withFolder));
        await onExists();
      }
    },
    async logout() {
      calls.push("logout");
    },
  };
}

/** Looks the script up by IMAP host in fixtures/imap/<host>.json; a host with no recording refuses, like a server that is down. */
export const replayFactory: ImapSessionFactory = (cfg: ImapConfig): ImapSession => {
  if (!/^[a-z0-9.-]+$/.test(cfg.host) || cfg.host.includes("..")) return refused("The host is not a recorded replay.");
  try {
    const file = fileURLToPath(new URL(`./imap/${cfg.host}.json`, import.meta.url));
    return sessionFromScript(JSON.parse(readFileSync(file, "utf8")) as ReplayScript);
  } catch {
    return refused("No recorded IMAP response for this host.");
  }
};

function refused(message: string): ImapSession {
  const down = async (): Promise<never> => { throw new Error(message); };
  return { connect: down, noop: down, fetchAfter: down, idle: down, logout: async () => {} };
}
