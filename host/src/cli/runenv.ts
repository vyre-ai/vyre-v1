// `vyre run --env <folder> [--purpose why] -- command args`: put a Vault folder's items into ONE child process's environment and nowhere else (spec 2.17). The capability vault.inject_env
// answers with key names and handles, never values; the values come from the vault filler process (VYRE_FILLER_SOCKET, one JSON line per handle) and go straight into the child's environment.
// The CLI keeps no copy, writes no file and prints no value; the filler scrubs the child's output streams and reports a miss through vault.report_scrub_miss.
import net from "node:net";
import { spawn } from "node:child_process";
import { flagText } from "./args.ts";
import type { Parsed } from "./args.ts";
import { callCap, NotRunning, resolveTarget, showError, notRunningHint } from "./client.ts";
import { EXIT, errLine } from "./io.ts";
import type { CliIo } from "./io.ts";

/** Ask the filler socket for one handle's value: `{"op":"resolve","handle":H}` answered by `{"value":V}` or `{"error":E}`. */
export function socketFiller(socketPath: string): (handle: string) => Promise<string> {
  return (handle) => new Promise<string>((resolve, reject) => {
    const sock = net.connect(socketPath);
    let buf = "";
    sock.setEncoding("utf8");
    sock.once("error", (e) => reject(new Error(`cannot reach the vault filler: ${e.message}`)));
    sock.on("data", (d: string) => {
      buf += d;
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      sock.end();
      try {
        const m = JSON.parse(buf.slice(0, nl)) as { value?: unknown; error?: unknown };
        if (typeof m.value === "string") resolve(m.value); else reject(new Error(typeof m.error === "string" ? m.error : "the filler refused the handle"));
      } catch { reject(new Error("the filler sent something that is not JSON")); }
    });
    sock.write(`${JSON.stringify({ op: "resolve", handle })}\n`);
  });
}

/** A filler that asks the server, with the caller's own token, for one handle's value (vault.fill with returnValue: only a person at View level gets it, and the call is logged as a use). */
export function serverFiller(io: CliIo, target: Parameters<typeof callCap>[1]): (handle: string) => Promise<string> {
  return async (handle) => {
    const r = await callCap(io, target, "vault.fill", { handle, target: { kind: "env", ref: "vyre-run" }, returnValue: true });
    if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
    const v = (r.data as { value?: unknown }).value;
    if (typeof v !== "string") throw new Error(`the server did not give ${handle}'s value`);
    return v;
  };
}

/** Removes every value from a stream of text, also when a value is split across two chunks (the last longest-value-minus-one characters are held back). */
export function scrubber(values: string[], write: (text: string) => void): { push(chunk: string): void; end(): void } {
  const secrets = [...new Set(values)].filter((v) => v.length >= 4).sort((a, b) => b.length - a.length);
  const hold = secrets.length ? secrets[0]!.length - 1 : 0;
  let buf = "";
  const clean = (t: string): string => { for (const v of secrets) t = t.split(v).join("[vault]"); return t; };
  return {
    push(chunk) {
      buf = clean(buf + chunk);
      if (buf.length > hold) { write(buf.slice(0, buf.length - hold)); buf = buf.slice(buf.length - hold); }
    },
    end() { if (buf) write(clean(buf)); buf = ""; },
  };
}

export async function runEnv(io: CliIo, p: Parsed): Promise<number> {
  const folder = flagText(p, "env");
  if (!folder || p.rest.length === 0) { errLine(io, "usage: vyre run --env <folder> [--purpose text] -- <command> [args]"); return EXIT.USAGE; }
  const target = resolveTarget(io, p.flags);
  if (!target) { errLine(io, "No server or token found. Use --server and --token, or run on the server's own machine."); return EXIT.USAGE; }
  // The filler socket when a filler process is running; otherwise the server itself hands each value to the caller's own token (the CLI then scrubs the child's output).
  const viaServer = !io.filler && !io.env["VYRE_FILLER_SOCKET"];
  const filler = io.filler ?? (io.env["VYRE_FILLER_SOCKET"] ? socketFiller(io.env["VYRE_FILLER_SOCKET"]) : serverFiller(io, target));
  let r: Awaited<ReturnType<typeof callCap>>;
  try { r = await callCap(io, target, "vault.inject_env", { folderId: folder, ...(flagText(p, "purpose") ? { purpose: flagText(p, "purpose") } : {}) }); }
  catch (e) { if (e instanceof NotRunning) { errLine(io, `${e.message}. ${notRunningHint}`); return EXIT.NOT_RUNNING; } throw e; }
  if (!r.ok) return showError(io, r);
  const d = r.data as { handles?: string[]; keys?: string[] };
  const handles = d.handles ?? [], keys = d.keys ?? [];
  if (handles.length !== keys.length) { errLine(io, "The server sent a different number of keys and handles; nothing was run."); return EXIT.FAILED; }
  const env: Record<string, string> = {};
  // Nothing the CLI prints may hold a value it has fetched, whatever text came back with an error.
  const mask = (t: string): string => { for (const v of Object.values(env)) if (v.length >= 4) t = t.split(v).join("[vault]"); return t; };
  try { for (let i = 0; i < keys.length; i++) env[keys[i]!] = await filler(handles[i]!); }
  catch (e) { errLine(io, mask(e instanceof Error ? e.message : String(e))); return EXIT.FAILED; }
  const [cmd, ...args] = p.rest;
  return new Promise<number>((resolve) => {
    const child = spawn(cmd!, args, { env: { ...io.env, ...env }, cwd: io.cwd, stdio: io.inherit && !viaServer ? "inherit" : ["ignore", "pipe", "pipe"], windowsHide: true });
    const values = Object.values(env);
    const out = viaServer ? scrubber(values, io.out) : null, err = viaServer ? scrubber(values, io.err) : null;
    child.stdout?.on("data", (c: Buffer) => { if (out) out.push(c.toString()); else io.out(c.toString()); });
    child.stderr?.on("data", (c: Buffer) => { if (err) err.push(c.toString()); else io.err(c.toString()); });
    child.once("error", (e) => { errLine(io, mask(`${cmd}: ${e.message}`)); resolve(127); });
    child.once("close", (code, signal) => { out?.end(); err?.end(); resolve(code ?? (signal ? 128 : EXIT.FAILED)); });
  });
}
