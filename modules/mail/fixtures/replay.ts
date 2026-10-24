// Recorded IMAP sessions. The method names follow imapflow: connect, noop, idle, fetch, logout.
// CI never opens a socket. A live imapflow client can be bound per context with bindImapSession.
// modules/mail cannot import imapflow (boundary B6). The host injects it when a packet wires the client.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { MailCtx } from "./db.ts";

export interface ImapParty {
  address: string;
  name?: string;
  contactId?: string;
}

export interface ImapFetched {
  providerId: string;
  rfcMessageId: string;
  threadKey?: string;
  direction?: "in" | "out";
  from: ImapParty;
  to: ImapParty[];
  cc?: ImapParty[];
  subject: string;
  text?: string;
  html?: string;
  receivedAt: number;
}

export interface ImapConfig {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  passwordHandle: string;
}

export interface ImapSession {
  connect(): Promise<void>;
  noop(): Promise<void>;
  fetchUnseen(): Promise<ImapFetched[]>;
  idle(onExists: (info: { exists: number }) => Promise<void>): Promise<void>;
  fetchSince(exists: number): Promise<ImapFetched[]>;
  logout(): Promise<void>;
}

export type ImapSessionFactory = (cfg: ImapConfig) => ImapSession;

interface ReplayScript {
  login?: boolean;
  noop?: boolean;
  unseen?: ImapFetched[];
  idle?: { exists: number; messages: ImapFetched[] }[];
}

const bound = new WeakMap<MailCtx, ImapSessionFactory>();

export function bindImapSession(ctx: MailCtx, factory: ImapSessionFactory): void {
  bound.set(ctx, factory);
}

export function openImapSession(ctx: MailCtx, cfg: ImapConfig): ImapSession {
  const factory = bound.get(ctx) ?? replayFactory;
  return factory(cfg);
}

function replayFactory(cfg: ImapConfig): ImapSession {
  if (!/^[a-z0-9.-]+$/.test(cfg.host) || cfg.host.includes("..")) {
    return refused("The mailbox host is not a recorded replay.");
  }
  try {
    const file = fileURLToPath(new URL(`./imap/${cfg.host}.json`, import.meta.url));
    const script = JSON.parse(readFileSync(file, "utf8")) as ReplayScript;
    return sessionFromScript(script);
  } catch {
    return refused("No recorded IMAP response for this host.");
  }
}

function refused(message: string): ImapSession {
  const fail = async (): Promise<never> => { throw new Error(message); };
  return {
    connect: fail,
    noop: fail,
    fetchUnseen: fail,
    idle: fail,
    fetchSince: fail,
    logout: async () => {},
  };
}

export function sessionFromScript(script: ReplayScript): ImapSession {
  const steps = script.idle ?? [];
  return {
    async connect() {
      if (script.login === false) throw new Error("LOGIN failed");
    },
    async noop() {
      if (script.noop === false) throw new Error("NOOP failed");
    },
    async fetchUnseen() {
      return script.unseen ?? [];
    },
    async idle(onExists) {
      for (const step of steps) await onExists({ exists: step.exists });
    },
    async fetchSince(exists) {
      const step = steps.find((item) => item.exists === exists);
      return step?.messages ?? [];
    },
    async logout() {},
  };
}
