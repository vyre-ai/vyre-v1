// mail module entry (lane L5). The host loads the generated stubs while manifests/mail.ts says `status: 'stub'`; the last mail packet flips
// it to live, after the contract tests pass against these handlers. Capabilities not listed here are served by their stub until then.
//
// Also here: the live IMAP session. It is imapflow behind the ImapSession seam of handlers/ingest.ts, loaded on first use (dynamic import)
// so a Space with no IMAP mailbox never loads it. CI never reaches it: tests bind recorded sessions, and tests/imap-live.test.ts drives this
// code against a fake imapflow. Reads use imapflow's default BODY.PEEK fetch and a read-only folder lock, so the person's unread mail stays unread.
import { fail } from "../../host/src/routes/errors.ts";
import type { Handler } from "../../host/src/invoke.ts";
import { connect, draft, draftsDiscard, draftsList, ingest, messageErase, send, sendAs, sendPreview, syncNow } from "./handlers/index.ts";
import { extraHandlers } from "./handlers/extra/index.ts";
import { setDefaultImapSession } from "./handlers/ingest.ts";
import type { ImapConfig, ImapMessage, ImapSession, ImapSessionFactory } from "./handlers/ingest.ts";
import type { MailCtx, Party } from "./projections.ts";
import { codecs, consumers, inline } from "./projections.ts";

export const handlers: Record<string, Handler> = {
  "mail.ingest": (ctx, input) => ingest(ctx, input),
  "mail.connect": (ctx, input) => connect(ctx, input),
  "mail.sync_now": (ctx, input) => syncNow(ctx, input),
  "mail.draft": (ctx, input) => draft(ctx, input),
  "mail.drafts.list": (ctx, input) => draftsList(ctx, input),
  "mail.drafts.discard": (ctx, input) => draftsDiscard(ctx, input),
  "mail.send": (ctx, input) => send(ctx, input),
  "mail.send_as": (ctx, input) => sendAs(ctx, input),
  "mail.send_preview": (ctx, input) => sendPreview(ctx, input),
  "mail.message.erase": (ctx, input) => messageErase(ctx, input),
  // mailbox admin, message reads, attachment save, health, status updates, auto-connect, sending domains and routes (P-L5_01c)
  ...extraHandlers,
};

export const projections = { inline, consumers };
export { codecs, inline, consumers };

// ---- live IMAP over imapflow

export interface FlowAddress { name?: string; address?: string }
export interface FlowFetched {
  uid: number;
  envelope?: { messageId?: string; subject?: string; from?: FlowAddress[]; to?: FlowAddress[]; cc?: FlowAddress[] };
  internalDate?: Date | string;
  source?: Uint8Array;
}
export interface FlowClient {
  connect(): Promise<void>;
  noop(): Promise<void>;
  logout(): Promise<void>;
  close?(): void;
  mailbox: false | { uidValidity: bigint | number };
  getMailboxLock(path: string, opts?: { readOnly?: boolean }): Promise<{ release(): void }>;
  list(): Promise<{ path: string; specialUse?: string }[]>;
  fetch(range: string, query: Record<string, boolean>, opts: { uid: boolean }): AsyncIterable<FlowFetched>;
  idle(): Promise<unknown>;
  on(event: "exists", cb: () => void): unknown;
  off(event: "exists", cb: () => void): unknown;
}
export type FlowCtor = new (opts: { host: string; port: number; secure: boolean; auth: { user: string; pass: string }; logger: false }) => FlowClient;
export interface ParsedMail {
  text?: string;
  html?: string | false;
  inReplyTo?: string;
  references?: string | string[];
}

export interface LiveImapDeps {
  loadImapflow(): Promise<FlowCtor>;
  parseMail(source: Uint8Array): Promise<ParsedMail>;
  /** The Vault password for a handle. The host injects the value at the last moment; module code never stores it. */
  secret(handle: string, ctx: MailCtx): Promise<string>;
}

let secretResolver: LiveImapDeps["secret"] | null = null;
/** The host's vault filler registers how an IMAP password handle becomes the value for one login. */
export function setImapSecretResolver(fn: LiveImapDeps["secret"] | null): void {
  secretResolver = fn;
}

/** The default secret source: the resolver the host registered, else a refusal the owner sees as a failed sign-in. */
export async function vaultSecret(handle: string, ctx: MailCtx): Promise<string> {
  if (!secretResolver) throw fail("provider.auth_failed", ctx.trace.traceId, { message: "The vault did not release the mailbox password." });
  return secretResolver(handle, ctx);
}

const defaultDeps: LiveImapDeps = {
  async loadImapflow() {
    const mod = (await import("imapflow")) as unknown as { ImapFlow: FlowCtor };
    return mod.ImapFlow;
  },
  async parseMail(source) {
    const mod = (await import("mailparser")) as unknown as { simpleParser(s: Uint8Array): Promise<ParsedMail> };
    return mod.simpleParser(source);
  },
  secret: vaultSecret,
};

const INBOX = "INBOX";
const toParty = (a: FlowAddress): Party | null => (a.address ? (a.name ? { address: a.address, name: a.name } : { address: a.address }) : null);
const parties = (list: FlowAddress[] | undefined): Party[] => (list ?? []).map(toParty).filter((p): p is Party => p !== null);

/** IDLE until the server reports new mail or `ms` pass. Any later command ends the IDLE, so the wait never outlives the call. */
function waitForExists(c: FlowClient, ms: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const done = (v: boolean): void => {
      clearTimeout(timer);
      c.off("exists", onEvent);
      resolve(v);
    };
    const onEvent = (): void => done(true);
    const timer = setTimeout(() => done(false), Math.max(0, ms));
    c.on("exists", onEvent);
    c.idle().catch(() => done(false));
  });
}

export function createLiveImapFactory(deps: LiveImapDeps = defaultDeps): ImapSessionFactory {
  return (cfg: ImapConfig, ctx: MailCtx): ImapSession => {
    let client: FlowClient | null = null;
    let uidValidity = 0;
    const need = (): FlowClient => {
      if (!client) throw new Error("IMAP session is not connected");
      return client;
    };

    const sentFolder = async (c: FlowClient): Promise<string | null> => {
      const all = await c.list();
      return all.find((f) => f.specialUse === "\\Sent")?.path ?? null;
    };

    const readFolder = async (c: FlowClient, folder: string, after: number): Promise<ImapMessage[]> => {
      const out: ImapMessage[] = [];
      const lock = await c.getMailboxLock(folder, { readOnly: true });
      try {
        const epoch = c.mailbox ? Number(c.mailbox.uidValidity) : 0;
        if (folder === INBOX) uidValidity = epoch;
        // "N:*" always yields the newest message even when it is older than N: the uid check below drops it.
        for await (const m of c.fetch(`${after + 1}:*`, { uid: true, envelope: true, internalDate: true, source: true }, { uid: true })) {
          if (m.uid <= after) continue;
          const parsed = m.source ? await deps.parseMail(m.source) : {};
          const env = m.envelope ?? {};
          const providerId = `${folder}:${epoch}:${m.uid}`;
          const from = parties(env.from)[0] ?? { address: cfg.username };
          const refs = Array.isArray(parsed.references) ? parsed.references.join(" ") : (parsed.references ?? "");
          const headers: Record<string, string> = {};
          if (parsed.inReplyTo) headers["in-reply-to"] = parsed.inReplyTo;
          if (refs) headers.references = refs;
          const msg: ImapMessage = {
            folder, uid: m.uid, providerId, rfcMessageId: env.messageId || `<${providerId}@${cfg.host}>`,
            direction: folder === INBOX ? "in" : "out", from, to: parties(env.to), subject: env.subject ?? "",
            receivedAt: m.internalDate ? new Date(m.internalDate).getTime() : ctx.now(),
          };
          const cc = parties(env.cc);
          if (cc.length) msg.cc = cc;
          if (parsed.text !== undefined) msg.text = parsed.text;
          if (parsed.html) msg.html = parsed.html;
          if (Object.keys(headers).length) msg.headers = headers;
          out.push(msg);
        }
      } finally {
        lock.release();
      }
      return out;
    };

    return {
      async connect() {
        const pass = await deps.secret(cfg.passwordHandle, ctx);   // the vault answers first: a refusal never loads the library
        const Flow = await deps.loadImapflow();
        client = new Flow({ host: cfg.host, port: cfg.port, secure: cfg.secure, auth: { user: cfg.username, pass }, logger: false });
        await client.connect();
        const lock = await client.getMailboxLock(INBOX, { readOnly: true });
        try {
          uidValidity = client.mailbox ? Number(client.mailbox.uidValidity) : 0;
        } finally {
          lock.release();
        }
        return { uidValidity };
      },
      async noop() {
        await need().noop();
      },
      async fetchAfter(uids) {
        const c = need();
        const out = await readFolder(c, INBOX, uids[INBOX] ?? 0);
        const sent = await sentFolder(c);
        if (sent) out.push(...(await readFolder(c, sent, uids[sent] ?? 0)));
        return out;
      },
      async idle(onExists, ms) {
        const c = need();
        const deadline = Date.now() + ms;
        while (Date.now() < deadline) {
          const lock = await c.getMailboxLock(INBOX, { readOnly: true });
          let woke: boolean;
          try {
            woke = await waitForExists(c, deadline - Date.now());
          } finally {
            lock.release();   // the catch-up fetch takes its own lock
          }
          if (!woke) return;
          await onExists();
        }
      },
      async logout() {
        if (!client) return;
        const c = client;
        client = null;
        try { await c.logout(); } catch { c.close?.(); }
      },
    };
  };
}

// Production binding. Tests override it per context with bindImapSession.
setDefaultImapSession(createLiveImapFactory());

/** Where the host registers the IMAP secret resolver at boot (ruling 31): the loader reads this export. */
export const hostSeams: import("../../host/src/seams/index.ts").SeamSetters = { setImapSecretResolver };
