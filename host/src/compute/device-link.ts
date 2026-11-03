// A person's own computer joined to a Team Space for their own turns (lane l-runson; owner rulings 2 and 3 Nov: "I wanna be able to stay in control of where I run it"). The Vyre app's device daemon
// holds one outbound socket to the Space's /compute/stream, signed in as the person (their own session, the one the app holds for that Space), and runs the CLI engine of a turn the Space places
// here, through this computer's own engine launcher and sandbox. The Space keeps the turn (queue, lease, tools over MCP, approvals, Stop, the record); only the engine process runs here.
//
//   one link per Space the person is signed in to on this computer (the app hands the session over: POST /local/chrome/spaces, see daemon.ts), dialled again after a drop
//   the hello says which engines this computer runs, so the Space never sends a turn it cannot take
//   a spawn for anyone but the person this link was signed in as is refused (cliRelay's person lock), whatever the Space says
//   the engine signs in the way it does on this computer by itself (owner, 3 Nov): when the person is signed in to Claude Code or Codex here (~/.claude, CODEX_HOME), the engine runs with that
//   home and the account the Space filled in is taken out, so their own subscription on their own Mac pays (ownSignin below); not signed in here, the Space's fill stands
//   a dial that does not open (the Space is unreachable, the computer just woke, or the session was signed out) is tried again, waiting longer each time up to a minute; the app takes the link away
//   at sign-out (DELETE /local/chrome/spaces)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cliRelay } from "./node.ts";
import type { NodeLauncher, NodeSocket } from "./node.ts";

export interface DeviceLinkDeps {
  /** The Space's address as this computer reaches it (https://team.example.com). */
  server: string;
  /** The person's own signed-in session for that Space. Held in memory only. */
  token: string;
  /** The data folder the launcher's sandbox works under: an engine runs in the launcher's work folder (<dataDir>/work/<person>/<process> on a Mac and Linux). */
  dataDir: string;
  /** What this computer calls itself in the Runs-on menu. */
  name: string;
  /** The engines this computer can run (driver ids: claude_code, codex, grok). */
  engines: readonly string[];
  launcher: NodeLauncher;
  socket(url: string, headers: Record<string, string>): NodeSocket;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  signal: AbortSignal;
  log(line: string): void;
  /** Pause between dials after a drop. Default 2 s. */
  retryMs?: number;
  /** Where the person's own engine homes are looked for (tests). Default: this computer's home and environment. */
  homes?: OwnHomes;
}

/** What ownSignin reads of this computer. */
export interface OwnHomes {
  home: string; env: Readonly<Record<string, string | undefined>>; platform: NodeJS.Platform; exists(p: string): boolean;
  /** The clock (tests). Default Date.now. */
  now?: () => number;
  /** The Mac login Keychain, read and written by this daemon (outside any sandbox). Absent: none (Linux, Windows, a test). */
  keychain?: { read(service: string): string | null; write(service: string, text: string): void };
}

/** The Keychain entry Claude Code keeps its sign-in in on a Mac (the same one l-decisions' local-signin reader reads). */
export const CLAUDE_KEYCHAIN = "Claude Code-credentials";

/** When a Claude Code sign-in's access token runs out (epoch ms), or undefined when it does not say. */
const claudeExpiry = (text: string | null): number | undefined => { try { const t = (JSON.parse(text ?? "") as { claudeAiOauth?: { expiresAt?: unknown } }).claudeAiOauth?.expiresAt; return typeof t === "number" ? t : undefined; } catch { return undefined; } };

/** The access token in a Claude Code credentials file, or "" (to tell a refresh from the file as written). */
const claudeToken = (text: string | null): string => { try { const t = (JSON.parse(text ?? "") as { claudeAiOauth?: { accessToken?: unknown } }).claudeAiOauth?.accessToken; return typeof t === "string" ? t : ""; } catch { return ""; } };

/**
 * Claude Code on a Mac keeps its sign-in in the Keychain, which an engine inside Seatbelt does not read reliably. So the daemon reads the entry once per process (outside the sandbox), writes it as
 * .credentials.json into a private config folder for the person inside their scratch folder (which the sandbox opens for the turn, and nothing else's), and points CLAUDE_CONFIG_DIR there:
 * Claude Code reads that file and refreshes it in place (owner decision D2, proved on 2.1.316). When the process ends, a refreshed token is written back to the Keychain, so the person's own
 * Claude Code stays signed in, and the file is removed. A warm engine lives across turns, so a refresh is also written back as soon as the file changes (checked every `watchMs`).
 * The access token also goes in CLAUDE_CODE_OAUTH_TOKEN: the desktop CI's run of the real Claude Code on macOS under Seatbelt (mac-claude-signin.heavy.test.ts) found that on a Mac it does not read
 * the file and says "Not logged in", while it does take the token from that variable. A token that has run out is not handed over at all: the turn takes the Space's fill of the person's account,
 * and the person's own Claude Code refreshes the Keychain entry the next time they use it.
 */
export function macClaude(env: Readonly<Record<string, string>>, h: OwnHomes, dataDir: string, person: string, proc: string, watchMs = 2_000): { env: Record<string, string>; after(): void } | null {
  if (h.platform !== "darwin" || !h.keychain) return null;
  const text = h.keychain.read(CLAUDE_KEYCHAIN);
  if (!text || claudeToken(text) === "") return null;
  const expires = claudeExpiry(text);
  if (expires !== undefined && expires <= (h.now ?? Date.now)() + 60_000) return null;
  const dir = path.join(dataDir, "scratch", safePart(person), "claude-own", proc);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, ".credentials.json");
  fs.writeFileSync(file, text, { mode: 0o600 });
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (k !== "CLAUDE_CODE_OAUTH_TOKEN" && k !== "ANTHROPIC_API_KEY") out[k] = v;
  out["CLAUDE_CONFIG_DIR"] = dir;
  out["CLAUDE_CODE_OAUTH_TOKEN"] = claudeToken(text);
  let last = claudeToken(text);
  const writeBack = (): void => {
    let now: string | null = null;
    try { now = fs.readFileSync(file, "utf8"); } catch { now = null; }
    const t = claudeToken(now);
    if (now !== null && t !== "" && t !== last) { try { h.keychain!.write(CLAUDE_KEYCHAIN, now); last = t; } catch { /* the next check tries again */ } }
  };
  const watch = setInterval(writeBack, watchMs);
  watch.unref?.();
  let done = false;
  return {
    env: out,
    after() {
      if (done) return;
      done = true;
      clearInterval(watch);
      writeBack();
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* the scratch folder is the person's own */ }
    },
  };
}
const safePart = (id: string): string => { const v = id.replace(/[^a-zA-Z0-9_-]/g, "_"); return v === "" || v === "." || v === ".." ? "node" : v; };

/** The environment variable a spawn carries what the engine may touch in (sandbox/src/engine-access.ts ACCESS_ENV). */
const ACCESS_ENV = "VYRE_ENGINE_ACCESS";
/** What each CLI keeps its sign-in in, and the variables the Space's fill puts an account in. */
/** The path rules of the computer the homes are on (a test names another platform than the one it runs on). */
const pathOf = (h: { platform: NodeJS.Platform }): typeof path.posix => (h.platform === "win32" ? path.win32 : path.posix);

const ENGINE_HOMES: Readonly<Record<string, { dirEnv: string; dir(h: OwnHomes): string; signedIn(dir: string, h: OwnHomes): boolean; keys: readonly string[] }>> = {
  claude: {
    dirEnv: "CLAUDE_CONFIG_DIR",
    dir: (h) => h.env["CLAUDE_CONFIG_DIR"] ?? pathOf(h).join(h.home, ".claude"),
    // a sign-in file (Linux, Windows, or a Mac set up that way); a Mac's Keychain sign-in is handed over as a file by macClaude
    signedIn: (dir, h) => h.exists(pathOf(h).join(dir, ".credentials.json")),
    keys: ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"],
  },
  codex: {
    dirEnv: "CODEX_HOME",
    dir: (h) => h.env["CODEX_HOME"] ?? pathOf(h).join(h.home, ".codex"),
    signedIn: (dir, h) => h.exists(pathOf(h).join(dir, "auth.json")),
    keys: ["CODEX_API_KEY", "OPENAI_API_KEY", "VYRE_CRED_FILES"],
  },
};

/**
 * The engine's environment on the person's own computer: when they are signed in to this CLI here, it runs with their own engine home (CLAUDE_CONFIG_DIR, CODEX_HOME), which its sandbox may
 * read and write (added to the turn's folders), and without the account the Space filled in. Otherwise the environment is as the Space sent it.
 */
export function ownSignin(argv: readonly string[], env: Readonly<Record<string, string>>, h: OwnHomes): Record<string, string> {
  const e = ENGINE_HOMES[path.basename(argv[0] ?? "")];
  if (!e) return { ...env };
  const dir = e.dir(h);
  if (!e.signedIn(dir, h)) return { ...env };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (!e.keys.includes(k)) out[k] = v;
  out[e.dirEnv] = dir;
  try {
    const asked = (env[ACCESS_ENV] ? JSON.parse(env[ACCESS_ENV]) : { where: "own", folders: [] }) as { where?: string; folders?: string[] };
    out[ACCESS_ENV] = JSON.stringify({ ...asked, where: "own", folders: [...new Set([...(asked.folders ?? []), dir])] });
  } catch { /* a list Vyre did not write is left for the sandbox to refuse */ }
  return out;
}

/** How the Keychain is reached: one program run, its arguments, and what it is given on stdin. */
export type RunSecurity = (args: readonly string[], input?: string) => string;
const runSecurity: RunSecurity = (args, input) => execFileSync("/usr/bin/security", [...args], { encoding: "utf8", timeout: 10_000, ...(input !== undefined ? { input } : {}), stdio: [input !== undefined ? "pipe" : "ignore", "pipe", "ignore"] });

/**
 * The Mac login Keychain. The write goes through `security -i`, with the command (and the token, as hex) on its stdin: nothing of the sign-in is ever in a process's arguments, where another
 * program could read it.
 */
export function macKeychain(run: RunSecurity = runSecurity, user: string = os.userInfo().username): NonNullable<OwnHomes["keychain"]> {
  const quote = (v: string): string => `"${v.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
  return {
    read(service) { try { return run(["find-generic-password", "-s", service, "-w"]).trim() || null; } catch { return null; } },
    // -U updates the entry Claude Code made, for this login user, as Claude Code itself names it; -X takes the secret as hex, so no quoting can break the line
    write(service, text) { run(["-i"], `add-generic-password -U -s ${quote(service)} -a ${quote(user)} -X ${Buffer.from(text, "utf8").toString("hex")}\n`); },
  };
}
const thisComputer = (): OwnHomes => ({ home: os.homedir(), env: process.env, platform: process.platform, exists: (p) => fs.existsSync(p), ...(process.platform === "darwin" ? { keychain: macKeychain() } : {}) });

/** Hold the link until stopped, dialling again after a drop. */
export async function runDeviceLink(d: DeviceLinkDeps): Promise<"stopped"> {
  const server = d.server.replace(/\/+$/, "");
  const url = `${server.replace(/^http/, "ws")}/compute/stream`;
  let person: string | null = null;
  const homes = d.homes ?? thisComputer();
  const launcher = {
    async spawn(spec: Parameters<typeof d.launcher.spawn>[0]) {
      const env = ownSignin(spec.argv, spec.env, homes);
      // Claude Code on a Mac with no sign-in file: the Keychain's, handed over as a file in a private folder, and a refresh written back when the engine ends
      const mac = path.basename(spec.argv[0] ?? "") === "claude" && env["CLAUDE_CONFIG_DIR"] === undefined && person ? macClaude(env, homes, d.dataDir, person, path.basename(spec.cwd ?? "") || "turn") : null;
      const proc = await d.launcher.spawn({ ...spec, env: mac ? mac.env : env }).catch((e: unknown) => { mac?.after(); throw e; });
      if (mac) void proc.exited.then(() => mac.after(), () => mac.after());
      return proc;
    },
    // the engine module's folder layout passes through: on Windows its sandbox accepts only its own short hashed folders
    ...(d.launcher.workFolder ? { workFolder: (who: string, proc: string) => d.launcher.workFolder!(who, proc) } : {}),
  };
  const engines = cliRelay({ launcher, dataDir: d.dataDir, server, log: d.log, person: () => person });
  const base = d.retryMs ?? 2_000;
  let wait = base;
  for (;;) {
    if (d.signal.aborted) return "stopped";
    const ended = await once();
    if (d.signal.aborted) return "stopped";
    wait = ended === "closed" ? base : Math.min(wait * 2, 60_000);
    await d.sleep(wait, d.signal).catch(() => undefined);
  }

  /** One socket: open, hello, serve engine frames until it closes. "refused" when it never opened (401). */
  function once(): Promise<"closed" | "refused"> {
    return new Promise((resolve) => {
      let opened = false;
      let hb: ReturnType<typeof setInterval> | undefined;
      const up = d.socket(url, { authorization: `Bearer ${d.token}` });
      const say = (m: Record<string, unknown>): void => { try { up.send(JSON.stringify(m)); } catch { /* the socket is going away */ } };
      const end = (): void => {
        // the Space ends every process of a dropped link; this side stops them too, so nothing runs on with nobody to read it
        engines.killAll();
        person = null;
        if (hb) clearInterval(hb);
        d.signal.removeEventListener("abort", stop);
        resolve(opened ? "closed" : "refused");
      };
      const stop = (): void => up.close();
      d.signal.addEventListener("abort", stop, { once: true });
      up.onOpen(() => {
        opened = true;
        say({ t: "hello", engines: [...d.engines], name: d.name });
        hb = setInterval(() => say({ t: "hb" }), 15_000); hb.unref?.();
      });
      up.onClose(end);
      up.onMessage((data) => {
        if (typeof data !== "string") return;
        let m: Record<string, unknown>;
        try { m = JSON.parse(data) as Record<string, unknown>; } catch { return; }
        if (m["t"] === "ready") { person = typeof m["person"] === "string" ? m["person"] : null; if (person) d.log(`Linked to ${server} for ${person}.`); return; }
        if (typeof m["t"] === "string" && m["t"].startsWith("cli_")) engines.frame(m, say);
        // views, ports and machine questions are a server's; a person's computer answers none of them
      });
    });
  }
}
