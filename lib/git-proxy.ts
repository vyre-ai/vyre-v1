// The pure half of the Vyre git proxy (host/src/seams/git-proxy.ts): reading the command list at the start of a git push, saying what each ref needs from the person, and writing the
// few pkt-lines the proxy answers with itself. No network, no state, so every rule here is a plain test.
//
// DECISION: the proxy reads only the command list (the lines before the first flush) and hands every byte on unchanged. It never looks inside the pack.
// DECISION: a push it cannot read exactly is refused, never guessed at. A malformed length, a command list over the cap, a push certificate, a ref name git itself would not send: all refused.

export const MAX_COMMAND_BYTES = 64 * 1024;
export const MAX_COMMANDS = 200;
const MAX_PKT = 65520;
const ZERO = /^0+$/;
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
/** A ref git would send: under refs/, no space or control character, no "..", no "@{", no trailing slash or dot, no empty part. */
const REF = /^refs\/[^\s\x00-\x1f\x7f~^:?*[\\]+$/;

export class PktError extends Error {
  readonly code: "malformed" | "too_big" | "unsupported" | "empty";
  constructor(message: string, code: "malformed" | "too_big" | "unsupported" | "empty" = "malformed") { super(message); this.code = code; }
}

export interface RefCommand { old: string; new: string; ref: string }
export interface Update {
  commands: RefCommand[];
  caps: string[];
  /** The client will read the answer in side-band frames, so progress lines can be sent while the push waits. */
  sideBand: boolean;
  reportStatus: boolean;
  /** Bytes the command list took, flush included: everything after them is pack data. */
  used: number;
}

const refOk = (ref: string): boolean => REF.test(ref) && !ref.includes("..") && !ref.includes("@{") && !ref.includes("//") && !/[/.]$/.test(ref) && !ref.split("/").some((p) => p.startsWith(".") || p.endsWith(".lock"));

/**
 * Read the command list from the start of a receive-pack body. Returns the update once the first flush has arrived, or null while more bytes are needed. Throws PktError for a body that is not a
 * command list (never waits past the cap for one). `shallow` lines before the commands are allowed; a push certificate is not supported.
 */
export function readUpdate(buf: Uint8Array): Update | null {
  let at = 0;
  const commands: RefCommand[] = [];
  let caps: string[] | null = null;
  let first = true;
  for (;;) {
    if (at > MAX_COMMAND_BYTES) throw new PktError("The list of changes in this push is too long.", "too_big");
    if (buf.length - at < 4) return needMore(buf.length);
    const head = Buffer.from(buf.subarray(at, at + 4)).toString("latin1");
    if (!/^[0-9a-f]{4}$/.test(head)) throw new PktError("The push does not start with a list of changes.");
    const len = parseInt(head, 16);
    if (len === 0) {
      if (commands.length === 0) throw new PktError("The push names no change.", "empty");
      return { commands, caps: caps ?? [], sideBand: (caps ?? []).some((c) => c === "side-band-64k" || c === "side-band"), reportStatus: (caps ?? []).some((c) => c === "report-status" || c === "report-status-v2"), used: at + 4 };
    }
    if (len < 4 || len > MAX_PKT) throw new PktError("The push has a line of an impossible length.");
    if (at + len > MAX_COMMAND_BYTES + 4) throw new PktError("The list of changes in this push is too long.", "too_big");
    if (buf.length - at < len) return needMore(buf.length);
    const text = Buffer.from(buf.subarray(at + 4, at + len)).toString("utf8").replace(/\n$/, "");
    at += len;
    if (text.startsWith("push-cert")) throw new PktError("Signed pushes are not supported through Vyre.", "unsupported");
    if (text.startsWith("shallow ") && commands.length === 0 && OID.test(text.slice(8))) continue;
    const nul = text.indexOf("\0");
    if (nul >= 0 && !first) throw new PktError("The push has capabilities on a line that should not.");
    if (nul < 0 && first) { /* a first line with no capabilities is legal */ }
    const line = nul >= 0 ? text.slice(0, nul) : text;
    if (first) { caps = nul >= 0 ? text.slice(nul + 1).split(" ").filter(Boolean) : []; if (caps.length > 64) throw new PktError("The push names too many capabilities."); first = false; }
    const parts = line.split(" ");
    if (parts.length !== 3) throw new PktError("The push has a change that is not <old> <new> <ref>.");
    const [o, n, ref] = parts as [string, string, string];
    if (!OID.test(o) || !OID.test(n) || o.length !== n.length) throw new PktError("The push has a change with a bad object name.");
    if (!refOk(ref)) throw new PktError("The push names a branch or tag git would not accept.");
    commands.push({ old: o, new: n, ref });
    if (commands.length > MAX_COMMANDS) throw new PktError("The push changes too many branches at once.", "too_big");
  }
}
function needMore(have: number): null {
  if (have > MAX_COMMAND_BYTES + 4) throw new PktError("The list of changes in this push is too long.", "too_big");
  return null;
}

export type Need = "push_branch" | "push_default";
export interface RefNeed {
  command: RefCommand;
  /** The ref without refs/heads/ or refs/tags/. */
  short: string;
  kind: "create" | "update" | "delete";
  need: Need;
  /** Held for the person's OK even when their settings say Always: deleting the default branch. */
  always: boolean;
}

export const isDelete = (c: RefCommand): boolean => ZERO.test(c.new);
const shortOf = (ref: string): string => ref.replace(/^refs\/(?:heads|tags)\//, "");

/** What each ref needs (defaults: the branch the server names as its default, or main and master when it names none): the default branch is push_default, anything else is push_branch (tags and deletes too), and deleting the default branch is held whatever the settings say. */
export function needsOf(commands: readonly RefCommand[], defaults: readonly string[]): RefNeed[] {
  return commands.map((command) => {
    const del = isDelete(command), onDefault = defaults.some((d) => command.ref === `refs/heads/${d}`);
    return { command, short: shortOf(command.ref), kind: del ? "delete" : ZERO.test(command.old) ? "create" : "update", need: onDefault ? "push_default" : "push_branch", always: del && onDefault };
  });
}

/**
 * The default branch a git server advertises: the symref capability on the first line of its upload-pack advertisement, read as UTF-8 like the command list it is compared with. "empty" is a repository
 * with no refs at all (a first push has no default branch to protect yet); anything else that names no HEAD is "unknown", and a push to it is refused.
 */
export function defaultBranchOf(advert: Uint8Array): { branch: string } | "empty" | "unknown" {
  const text = Buffer.from(advert.subarray(0, Math.min(advert.length, 16 * 1024))).toString("utf8");
  const m = /symref=HEAD:refs\/heads\/([^\s\0]+)/.exec(text);
  if (m) return { branch: m[1]! };
  return /\0[^\n]*\bagent=/.test(text) && /capabilities\^\{\}/.test(text) && !/ refs\//.test(text) ? "empty" : "unknown";
}

// ---- what the proxy writes itself

export const pkt = (s: string | Uint8Array): Buffer => {
  const body = typeof s === "string" ? Buffer.from(s, "utf8") : Buffer.from(s);
  return Buffer.concat([Buffer.from((body.length + 4).toString(16).padStart(4, "0"), "latin1"), body]);
};
export const FLUSH = Buffer.from("0000", "latin1");

/** A side-band frame (1 data, 2 progress, 3 fatal), split so each pkt-line stays under the limit. */
export function band(channel: 1 | 2 | 3, text: string | Uint8Array): Buffer {
  const body = typeof text === "string" ? Buffer.from(text, "utf8") : Buffer.from(text);
  const out: Buffer[] = [];
  for (let i = 0; i < Math.max(body.length, 1); i += 65000) out.push(pkt(Buffer.concat([Buffer.from([channel]), body.subarray(i, i + 65000)])));
  return Buffer.concat(out);
}

/** One line of text a person reads as "remote: ..." at the end of a push. */
export const remoteLine = (text: string): Buffer => band(2, `${text}\n`);

/** One reason, on one line, with nothing a pkt-line or a terminal would misread. */
export const oneLine = (s: string): string => s.replace(/[\x00-\x1f\x7f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);

/**
 * The report a receive-pack sends when every change was turned down: "unpack ok" then "ng <ref> <reason>" for each. With side-band the report rides on channel 1 and ends with a flush on both layers.
 */
export function refusedReport(commands: readonly RefCommand[], reason: string, sideBand: boolean): Buffer {
  const inner = Buffer.concat([pkt("unpack ok\n"), ...commands.map((c) => pkt(`ng ${c.ref} ${oneLine(reason)}\n`)), FLUSH]);
  return sideBand ? Buffer.concat([band(1, inner), FLUSH]) : inner;
}

/** A client address: owner/repo.git under the proxy's path. Null for anything else. */
export function repoOfPath(rest: string): { repo: string; tail: "info/refs" | "git-receive-pack" | "git-upload-pack" } | null {
  const m = /^([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100})\.git\/(info\/refs|git-receive-pack|git-upload-pack)$/.exec(rest);
  if (!m) return null;
  const [, owner, name, tail] = m as unknown as [string, string, string, "info/refs" | "git-receive-pack" | "git-upload-pack"];
  if (owner === "." || owner === ".." || name === "." || name === "..") return null;
  return { repo: `${owner}/${name}`, tail };
}
