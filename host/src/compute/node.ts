// A computer that joins a Space for compute (`vyred --role compute --server <address> --join <code>`). It is a guest: it dials out, holds no event log, no replica and no Vault, and keeps only two small
// files in its data directory, its own key and what the Space handed it. First run: make an Ed25519 key, ask to join with the one-time code, print the name and the 8-character fingerprint a person
// compares when they approve, then wait. Once approved it holds one credential and reports in on a short cycle; a 401 means it was removed, so it forgets everything and stops.
import fs from "node:fs";
import path from "node:path";

export type NodeFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ status: number; json(): Promise<unknown> }>;

export interface NodeDeps {
  server: string;
  join?: string | undefined;
  dataDir: string;
  name: string;
  fetch: NodeFetch;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  now(): number;
  log(line: string): void;
  facts(): { os: string; arch: string; docker: boolean; version: string };
  signal: AbortSignal;
  /** how often an unapproved computer asks, and an admitted one reports, in milliseconds */
  pollMs?: number;
}
export type NodeEnd = "stopped" | "declined" | "removed";

const FP_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const b64 = (b: ArrayBuffer | Uint8Array): string => Buffer.from(b as ArrayBuffer).toString("base64");

/** The same eight characters the Space shows its approver: a hash of the public key, as ABCD-EFGH. */
export async function fingerprintOf(publicKey: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", Buffer.from(publicKey, "base64")));
  const chars = Array.from(digest.slice(0, 8), (x) => FP_ALPHABET[x % FP_ALPHABET.length]).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

interface KeyFile { privateKey: string; publicKey: string }
interface StateFile { serverId: string; fingerprint: string; credential?: string }

function readJson<T>(file: string): T | null { try { return JSON.parse(fs.readFileSync(file, "utf8")) as T; } catch { return null; } }
function writePrivate(file: string, value: unknown): void { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); fs.writeFileSync(file, JSON.stringify(value), { mode: 0o600 }); }

async function loadKey(dir: string): Promise<{ key: KeyFile; sign(text: string): Promise<string> }> {
  const file = path.join(dir, "compute-key.json");
  let key = readJson<KeyFile>(file);
  if (!key) {
    const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
    key = { privateKey: b64(await crypto.subtle.exportKey("pkcs8", pair.privateKey)), publicKey: b64(await crypto.subtle.exportKey("raw", pair.publicKey)) };
    writePrivate(file, key);
  }
  const priv = await crypto.subtle.importKey("pkcs8", Buffer.from(key.privateKey, "base64"), { name: "Ed25519" }, false, ["sign"]);
  return { key, sign: async (text) => b64(await crypto.subtle.sign({ name: "Ed25519" }, priv, new TextEncoder().encode(text))) };
}

export async function runComputeNode(d: NodeDeps): Promise<NodeEnd> {
  const server = d.server.replace(/\/+$/, "");
  const pollMs = d.pollMs ?? 3_000;
  const post = async (p: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; data: any }> => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await d.fetch(`${server}${p}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: d.signal });
    const j = (await r.json().catch(() => ({}))) as { data?: unknown };
    return { status: r.status, data: j.data ?? j };
  };
  const stateFile = path.join(d.dataDir, "compute-state.json");
  const { key, sign } = await loadKey(d.dataDir);
  let state = readJson<StateFile>(stateFile);
  const forget = (): void => { try { fs.rmSync(stateFile, { force: true }); fs.rmSync(path.join(d.dataDir, "compute-key.json"), { force: true }); } catch { /* nothing to forget */ } };

  if (!state) {
    if (!d.join) throw new Error("this computer has not joined a Space yet: give --join with the one-time code from Console, Network, Add a computer");
    const asked = await post("/v1/network/enroll", { code: d.join, publicKey: key.publicKey, name: d.name, facts: d.facts() });
    if (asked.status !== 200) throw new Error(`the Space did not accept the join code (${asked.status}): ${String(asked.data?.error?.message ?? "the code is wrong, used or expired")}`);
    state = { serverId: String(asked.data.serverId), fingerprint: String(asked.data.fingerprint) };
    writePrivate(stateFile, state);
    d.log(`Asked to join as "${d.name}". Fingerprint ${state.fingerprint}. Waiting for a person to approve it in Console, Network.`);
  } else if (!state.credential) {
    d.log(`Waiting for approval. Fingerprint ${state.fingerprint}.`);
  }

  // waiting: ask, signed, until a person decides
  while (!state.credential) {
    if (d.signal.aborted) return "stopped";
    const at = d.now();
    const r = await post("/v1/network/enroll_status", { serverId: state.serverId, at, signature: await sign(`vyre-enroll:${state.serverId}:${at}`) }).catch(() => null);
    if (r && r.status === 200) {
      if (r.data.state === "declined") { d.log("The Space turned this computer away."); forget(); return "declined"; }
      if (r.data.state === "revoked") { d.log("This computer was removed from the Space."); forget(); return "removed"; }
      if (r.data.state === "approved" && typeof r.data.credential === "string") {
        state = { ...state, credential: r.data.credential };
        writePrivate(stateFile, state);
        d.log("Approved. This computer is part of the Space now.");
        break;
      }
    } else if (r && r.status >= 400 && r.status < 500) { d.log("The Space does not know this computer any more."); forget(); return "removed"; }
    await d.sleep(pollMs, d.signal).catch(() => undefined);
  }

  // admitted: report in on a short cycle; a plain 401 means it was removed
  for (;;) {
    if (d.signal.aborted) return "stopped";
    const f = d.facts();
    const r = await post("/compute/poll", { docker: f.docker, version: f.version }, { authorization: `Bearer ${state.credential}` }).catch(() => null);
    if (r && r.status === 401) { d.log("This computer was removed from the Space. Its credential no longer works."); forget(); return "removed"; }
    await d.sleep(pollMs, d.signal).catch(() => undefined);
  }
}
