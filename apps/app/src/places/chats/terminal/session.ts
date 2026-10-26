// The calls the terminal tab makes, one function each (spec 2.7, ARCH 7.2): terminal.open and terminal.open_server start a session on a host, terminal.attach gives the scrollback and
// a ticket, terminal.read carries the live output after it, terminal.input sends the keys, terminal.resize the size, terminal.interrupt Ctrl-C, stars.toggle puts the session on Home.
// The tab calls these from its handlers and the tests call the same functions with a fake `call`, so what ui/Terminal asks for is the thing that is checked.
import { inputPayload, resizePayload } from "../../../../../../ui/src/Terminal/index.tsx";
import type { TerminalHost, TerminalSource } from "../../../../../../ui/src/Terminal/index.tsx";
import type { Rules, TerminalRow } from "./model.ts";
import { openCall, pollSource } from "./model.ts";
import type { ReadOut } from "./model.ts";

export interface SessionDeps {
  /** One capability call as the signed-in person; rejects with the capability's error. */
  call(cap: string, input: unknown): Promise<unknown>;
  newKey(): string;
}

export interface Attached {
  /** The scrollback the screen starts from. */
  replay: string;
  /** The live output after it, in order. */
  source: TerminalSource;
  ticket: string;
  expiresAt: number;
}

interface AttachOut { ticket: string; expiresAt: number; replay: string }

/** terminal.attach for the replay and ticket, then the cursor the live output continues from. */
export async function attach(d: SessionDeps, terminalId: string, everyMs?: number): Promise<Attached> {
  const a = (await d.call("terminal.attach", { terminalId })) as AttachOut;
  const at = (await d.call("terminal.read", { terminalId, lines: 1 })) as ReadOut;
  const source = pollSource((since) => d.call("terminal.read", { terminalId, since }) as Promise<ReadOut>, at.next, everyMs);
  return { replay: a.replay, source, ticket: a.ticket, expiresAt: a.expiresAt };
}

export interface Sender {
  /** Keys in the order they were pressed: each waits for the one before it. */
  input(data: string): Promise<boolean>;
  /** The size the pane holds, clamped to what the module accepts; a size already sent is not sent again. */
  resize(cols: number, rows: number): Promise<boolean>;
  interrupt(): Promise<boolean>;
}

export function createSender(d: SessionDeps, terminalId: string, onFail: (what: string) => void = () => undefined): Sender {
  let chain: Promise<unknown> = Promise.resolve();
  let sent = "";
  const run = (cap: string, input: unknown, what: string): Promise<boolean> => {
    const p = chain.then(() => d.call(cap, input));
    chain = p.catch(() => undefined);
    return p.then(() => true, () => { onFail(what); return false; });
  };
  return {
    // Ctrl-C reaches the shell through terminal.interrupt, so the byte itself is not sent a second time.
    input: (data) => (data === "\x03" ? Promise.resolve(true) : run("terminal.input", inputPayload(terminalId, data), "Not sent")),
    resize: (cols, rows) => {
      const p = resizePayload(terminalId, cols, rows);
      const key = `${p.cols}x${p.rows}`;
      if (key === sent) return Promise.resolve(true);
      sent = key;
      return run("terminal.resize", p, "Could not resize");
    },
    interrupt: () => run("terminal.interrupt", { terminalId }, "Could not interrupt"),
  };
}

/** A new session on a host. An agent computer needs the agent (or its computer); the Space server needs server.services and answers with a refusal without it. */
export async function openSession(d: SessionDeps, host: TerminalHost, who: { agentId?: string; computerId?: string }): Promise<TerminalRow> {
  const c = openCall(host, who, d.newKey());
  const out = (await d.call(c.cap, c.input)) as { terminal: TerminalRow };
  return out.terminal;
}

/** Star or unstar a session: the Home Starred section lists it, with its status, and a press there reattaches. */
export async function toggleStar(d: SessionDeps, terminalId: string, on: boolean): Promise<boolean> {
  try {
    await d.call("stars.toggle", { resource: { type: "terminal", id: terminalId }, on });
    return true;
  } catch {
    return false;
  }
}

/** "Ask for access": a request for the right to use the Space server's shell, which the Space's owners and Developers can grant. */
export async function askServerAccess(d: SessionDeps, spaceId: string): Promise<boolean> {
  try {
    await d.call("access.request", { resource: { type: "space", id: spaceId }, level: "use", note: "Terminal on the Space server (server.services)", idempotencyKey: d.newKey() });
    return true;
  } catch {
    return false;
  }
}

export async function renameSession(d: SessionDeps, terminalId: string, name: string): Promise<boolean> {
  try { await d.call("terminal.rename", { terminalId, name }); return true; } catch { return false; }
}

export async function closeSession(d: SessionDeps, terminalId: string): Promise<boolean> {
  try { await d.call("terminal.close", { terminalId }); return true; } catch { return false; }
}

/** Save the person's rules. What comes back is what the module kept: an entry on two lists stays only on the stronger one. */
export async function saveRules(d: SessionDeps, rules: Rules): Promise<Rules> {
  const out = (await d.call("terminal.rules.set", { rules })) as { rules: Rules };
  return out.rules;
}
