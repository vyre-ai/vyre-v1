// The real session opener on a daemon (P-L2_23, with P-L2_23c): the host half hands plain ports (Vault lookup, loopback MCP, scrub-miss report); this builds agent/src/drivers/open's
// opener from them. A CLI engine (Claude Code, Codex, Grok) runs as a local process with the key filled into its environment and reaches Vyre over the loopback MCP endpoint, where the
// agent's tools run through the invoke pipeline. An API-key driver gets the agent's role as its system prompt and no tools yet: running its tools needs the engine's tool runner (callTool),
// which is a separate packet; until then a chat on an API key answers in words only.
import { LaunchError, createLocalLauncher } from "../../agent/src/drivers/cli/launcher.ts";
import { ACCESS_ENV, RULE_ENV, SandboxError, WIN_SSH_AGENT_PIPE, accessFromEnv, engineAccess, ruleFromEnv } from "../../sandbox/src/index.ts";
import type { AccessAsked, EgressEvent, EgressRule, EngineAccess } from "../../sandbox/src/index.ts";
import os from "node:os";
import { openMcpBridge, openWslMcpBridge } from "./mcp-bridge.ts";
import { cliSandboxCode, enginePath, wallEgress, wallEgressOfRule } from "./sandbox-default.ts";
import { CLI_NAME, findProgram, isOwned, ownedDirs } from "./cli-programs.ts";
import type { NodeCliProbe } from "./cli-programs.ts";
import { sandboxWrap, scratchFolder, workFolder, workParts } from "./sandbox.ts";
import { ensureWorkspace } from "./handlers/crew.ts";
import { placeCredentialFiles, takeCredentialFiles } from "./credential-files.ts";
import type { Placed } from "./credential-files.ts";
import type { CliProcess, LaunchSpec, Launcher } from "../../agent/src/drivers/cli/types.ts";
import { nativePlugins } from "./plugin-native.ts";
import { syncNativeSkills } from "./skills-native.ts";
import type { SandboxPlan } from "./sandbox.ts";
import type { ApiTools } from "../../agent/src/drivers/open/api-tools.ts";
import type { SystemBlock } from "../../agent/src/drivers/api/types.ts";
import { createSessionOpener } from "../../agent/src/drivers/open/index.ts";
import type { McpPort, SessionOpener } from "../../agent/src/drivers/open/index.ts";
import type { ValueSource, VaultRunDeps } from "../../agent/src/vault-use/index.ts";
import { recallText } from "../../agent/src/turn-engine/recall.ts";
import { contextBlocks, ordered } from "../../agent/src/turn-engine/context.ts";
import type { ContextSection } from "../../agent/src/turn-engine/context.ts";
import { GUIDE_FILES, memoryGuide } from "../../lib/memory-guide.ts";
import fs from "node:fs";
import path from "node:path";
import type { SessionSpec, TurnInput } from "../../agent/src/turn-engine/types.ts";

/** What every engine process gets from the daemon's environment: the launcher's short list, with a PATH that finds the CLIs an app started from the Finder would not see. */
function launcherEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ["HOME", "LANG", "TMPDIR"]) { const v = process.env[k]; if (v !== undefined) out[k] = v; }
  out["PATH"] = enginePath(process.env, process.env["HOME"] ?? "/", process.platform, undefined, undefined, ownedDirs());
  return out;
}

/** The argv with Vyre's own copy of the program named by its full path, when that is the copy that runs: a sandbox's PATH (bwrap's is fixed) never holds the engines folder. Anything else is left as it is. */
export function ownedArgv(argv: readonly string[], probe?: NodeCliProbe): readonly string[] {
  const program = argv[0];
  if (program === undefined || !Object.hasOwn(CLI_NAME, program)) return argv;
  const found = findProgram(program, probe);
  return found !== null && isOwned(found, probe) ? [found, ...argv.slice(1)] : argv;
}

/** The ports the host builds (host/src/seams/engine-session.ts), as the module sees them: structural, so neither side imports the other. */
export interface EngineSessionPorts {
  source: ValueSource; reportMiss: VaultRunDeps["reportMiss"]; mcp: McpPort;
  /** The host's save of sign-in files a CLI refreshed during a turn (host/src/seams/signin-refresh.ts). Absent: a refresh is not saved back. */
  saveSignin?(r: { itemId: string; asker: string; filled: string; files: Readonly<Record<string, string | null>> }): Promise<unknown>;
}

export interface OpenerHost {
  session: EngineSessionPorts;
  /** Call a capability for a person; used for the agent's role. */
  call(cap: string, input: unknown, as?: string): Promise<unknown>;
  /** Where and how a CLI engine is sandboxed (the host decides). Without it a CLI turn fails with sandbox.unavailable: the engine never runs unwrapped. */
  sandbox?: SandboxPlan;
  /** The Space data directory (work folders live under it) and a builder for the default plan, used when the host gave none. Both come from the daemon. */
  dataDir?: string;
  defaultSandbox?: () => Promise<SandboxPlan>;
  /** Replace a CLI engine's program (argv[0], e.g. "claude") with a command, for a fake CLI in the booted test. Default: the real CLI. */
  cliCommand?: Readonly<Record<string, readonly string[]>>;
  /** Where programs are looked for (a test's folders). Default: this computer's PATH. */
  cliProbe?: NodeCliProbe;
  /** A test's own network for the API drivers (engineCli.apiFetch): it stands in for the provider, so the address guard is not in the way. Absent: the real network. */
  apiFetch?: typeof fetch;
  /** Tools for API-key chats (modules/engine/api-tools.ts). Without them an API chat answers in words only. */
  apiTools?: ApiTools;
  /**
   * The Space's network rule for a CLI engine, read when its process starts (the next turn after a change in the Console), and the record of where it went. Absent: the default, anything public.
   * A rule that cannot be read is "Only the AI providers": a failed read never opens more than the Space chose.
   */
  egress?: { rule(): Promise<EgressRule>; record?: EgressWatch };
  /**
   * What the engine may touch on files (owner ruling 3 Nov), asked as each process starts: the place ("own": the person's own computer; "server": a Space server) and the folders the person added
   * from their computer. Absent: the work folder only, as before. A failed read is the work folder and the toolbox only (server), never more.
   */
  access?: (asker: string, on: "space") => Promise<AccessAsked>;
  /** The opener of one person's own computer (node-turns.ts): the folders on it they added to Vyre, read as each engine process starts. Absent: none (a server's). */
  folders?: () => Promise<string[]>;
  own?: (person: string) => boolean;
  now?: () => number;
  /** Set false to keep installed plugins out of a CLI engine's own config. Default: they are written there. */
  pluginsNative?: boolean;
  /** Set false to keep the agent's skills out of a Claude Code or Codex work folder (skills-native.ts). Default: they are written there. */
  skillsNative?: boolean;
  /**
   * What a chat keeps between engine sessions (modules/engine/cli-sessions.ts): the CLI engine's own session id per chat, agent, person and engine (read when a session opens, written when the engine
   * names a new one), and the chat's "Keep this every time", written into the work folder's compact instructions. Absent: every session starts new, as before.
   */
  sessions?: {
    resume(k: { threadId: string; agentId: string; person: string; driver: string; tools?: "none" }): string | null;
    checkpoint(k: { threadId: string; agentId: string; person: string; driver: string; tools?: "none" }, sessionId: string | null): void;
    keep(threadId: string): string;
  };
}

import { PROBE_RULE } from "../../lib/probe.ts";
const MEMORY_RULES = "You remember through Vyre memory. Facts recalled for a message come with their source: say where you know a thing from. Quotes are the exact words people wrote in earlier chats and runs: quote them as written, never reword them, and use memory_quote with a ref to read a whole line or to look for words. Look up with memory_search, save what you learn with memory_remember and cite where it came from, and close a fact that is wrong or no longer true with memory_forget. Memory you cannot see is not yours to guess.";

/**
 * The system prompt of an API-key chat. With the turn context (modules/engine/context.ts) it is the ordered context: identity, rules, where, the memory block, skills, what the agent can do here,
 * the screen, the focus skill, the time, what it waits on. Stable sections come first and carry the cache marker. The memory block is the memory module's: the memory rules and the agent's MAP.md
 * as the nightly job last wrote it (agent layer only, never a person's memory); what memory recalled for this one message follows as a volatile block. A turn with no context (a failed build,
 * a test) gets the one-line role as before.
 */
export function roleBlocks(call: OpenerHost["call"]): (spec: SessionSpec, input?: TurnInput) => Promise<SystemBlock[]> {
  return async (spec, input) => {
    const memory: ContextSection[] = [{ id: "memory", stable: true, text: `${MEMORY_RULES} ${PROBE_RULE}` }];
    try {
      const out = (await call("memory.map.get", { agentId: spec.agent.id }, spec.asker)) as { map?: { body?: string } };
      if (out.map?.body) memory.push({ id: "memory", stable: true, text: `Your memory map (MAP.md):\n${out.map.body}` });
    } catch { /* no map yet, or this person may not read it: the turn goes on without it */ }
    const blocks: SystemBlock[] = [];
    if (input?.context) {
      const merged: ContextSection[] = ordered([...input.context.sections, { id: "memory", stable: true, text: memory.map((m) => m.text).join("\n\n") }]);
      blocks.push(...contextBlocks({ ...input.context, sections: merged }));
    } else {
      let text: string;
      try {
        const out = (await call("agents.get", { agentId: spec.agent.id }, spec.asker)) as { agent?: { name?: string; role?: string } };
        const a = out.agent;
        text = `You are ${a?.name ?? spec.agent.id}, an agent in Vyre.${a?.role ? ` ${a.role}` : ""}`;
      } catch {
        text = `You are ${spec.agent.id}, an agent in Vyre.`;
      }
      blocks.push({ text, stable: true }, ...memory.map((m) => ({ text: m.text, stable: true })));
    }
    const recalled = input?.recall ? recallText(input.recall) : "";
    if (recalled !== "") blocks.push({ text: recalled, stable: false });
    return blocks;
  };
}

/**
 * The memory guide of this agent as the person asking may read it (agent layer only), in the CLI's work folder as CLAUDE.md and AGENTS.md. A CLI engine reads one of them from its folder,
 * so it knows it has memory and which tools reach it before its first tool call. The work folder is per person, thread and agent, so nothing here reaches another person or another agent's folder.
 */
export async function writeMemoryGuide(call: OpenerHost["call"], dir: string, spec: { agent: { id: string }; asker: string }, keepExisting = false, keep = ""): Promise<void> {
  let name: string = spec.agent.id;
  let body: string | undefined;
  try { name = ((await call("agents.get", { agentId: spec.agent.id }, spec.asker)) as { agent?: { name?: string } }).agent?.name ?? name; } catch { /* the id names it */ }
  try { body = ((await call("memory.map.get", { agentId: spec.agent.id }, spec.asker)) as { map?: { body?: string } }).map?.body; } catch { /* no map yet, or not this person's to read */ }
  const text = memoryGuide(name, body) + compactInstructions(keep);
  for (const f of GUIDE_FILES) { if (keepExisting && fs.existsSync(path.join(dir, f))) continue; fs.writeFileSync(path.join(dir, f), text, { mode: 0o644 }); }
}

/**
 * The chat's "Keep this every time" as compact instructions in the file the CLI reads from its folder: Claude Code reads a "Compact instructions" section of CLAUDE.md when it compacts by itself, and
 * the file is part of what every engine reads again after a compaction, so what the person asked to keep survives the engine's own automatic compaction too.
 */
export function compactInstructions(keep: string): string {
  const k = keep.replace(/\s+/g, " ").trim();
  return k === "" ? "" : `\n\n# Compact instructions\n\nWhen this conversation is compacted or summarised, keep this, as the person asked: ${k}\n`;
}

/**
 * What a session's work folder needs before its first turn: a teammate thread of the crew gets its copy of the project repository on its own branch (made once, left alone after), then the memory guide.
 * The guide never overwrites a file the repository already tracks: the copy would show as changed.
 */
export async function prepareWorkFolder(call: OpenerHost["call"], dataDir: string, spec: { agent: { id: string }; asker: string; threadId: string }, keep = ""): Promise<void> {
  const dir = workFolder(dataDir, spec.asker, spec.threadId, spec.agent.id);
  const crew = await crewWorkspaceOf(call, spec);
  if (crew) await ensureWorkspace(dataDir, spec.asker, spec.threadId, spec.agent.id, crew);
  await writeMemoryGuide(call, dir, spec, crew !== null, keep);
}

type CrewWorkspace = { repo: string; base: string; branch: string; name: string };

/** The crew copy this thread works in, or null for any other thread. A teammate thread whose job row is not there yet (the start call has not finished) is waited for a moment. */
async function crewWorkspaceOf(call: OpenerHost["call"], spec: { asker: string; threadId: string }): Promise<CrewWorkspace | null> {
  const ask = async (): Promise<CrewWorkspace | null> => {
    try { return ((await call("engine.crew.workspace", { threadId: spec.threadId }, spec.asker)) as { workspace: CrewWorkspace | null }).workspace; } catch { return null; }
  };
  const found = await ask();
  if (found) return found;
  let helper = false;
  try { helper = ((await call("threads.get", { threadId: spec.threadId }, spec.asker)) as { thread?: { kind?: string } }).thread?.kind === "helper"; } catch { /* not readable: not a crew thread */ }
  if (!helper) return null;
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 300));
    const again = await ask();
    if (again) return again;
  }
  return null;
}

/** Saves of refreshed sign-ins still under way, so closing the opener at shutdown waits for them. */
const saving = new Set<Promise<void>>();
/** How long the files wait in the home for a save before they are removed anyway. */
const SAVE_WAIT_MS = 30_000;

/** When the engine has ended, however it ended: read the sign-in files back, hand them to `back` when they changed (a refreshed token), then remove them. */
function settleSignin(p: Placed, back: LaunchSpec["signinBack"]): void {
  let files: Record<string, string | null> | null = null;
  try { files = p.changed(); } catch { files = null; }
  const job = (async () => {
    try {
      if (files !== null && back) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([back(files), new Promise<void>((r) => { timer = setTimeout(r, SAVE_WAIT_MS); timer.unref?.(); })]).finally(() => clearTimeout(timer));
      }
    } catch { /* the host logs why; the values are never in an error here */ }
    finally { p.release(); }
  })();
  saving.add(job);
  void job.then(() => saving.delete(job));
}

/** Every refreshed sign-in handed over so far has been saved or refused, and its files removed. */
export async function signinsSettled(): Promise<void> {
  while (saving.size > 0) await Promise.allSettled([...saving]);
}

/**
 * Start a CLI engine for a turn inside the sandbox. A sign-in kept in files (Codex, Grok) arrives in the environment under VYRE_CRED_FILES, filled by the Vault; it is taken out of the environment and put in the
 * engine's own home for the life of the process, and removed when the process ends or fails to start. When the process ends (done, failed, cancelled, crashed, or killed at shutdown) the files are read back
 * first, and a sign-in the CLI refreshed goes to `spec.signinBack` before they are removed. `wrapOf` is the sandbox wrap; a test passes its own.
 *
 * The network: the rule the turn carries (RULE_ENV, the Space's choice when the turn started, set by the opener) is taken out of the environment and the process gets a wall of its own with it, which
 * stops when the process ends. No rule: the default, anything public. A plan with no way to open a wall (a host's own) keeps its one wall. `onEgress` hears where the process went, with the person and
 * the thread of the work folder.
 */
export async function spawnCli(planned: SandboxPlan, spec: LaunchSpec, argv: readonly string[], o: { wrapOf?: typeof sandboxWrap; onEgress?: EgressWatch } = {}): Promise<CliProcess> {
  const { signinBack, ...launch } = spec;
  const { [RULE_ENV]: ruleText, [ACCESS_ENV]: accessText, ...rest } = launch.env;
  const rule = ruleFromEnv(ruleText);
  const asked = accessFromEnv(accessText);
  const { env, files } = takeCredentialFiles(rest);
  let placed: Placed | undefined;
  if (files !== undefined) {
    if (launch.cwd === undefined) throw new LaunchError("engine.account_unavailable", "The engine has no work folder to keep its sign-in in.");
    try { placed = placeCredentialFiles(planned.dataDir, launch.cwd, files); } catch (e) { throw new LaunchError("engine.account_unavailable", e instanceof Error ? e.message : "The sign-in files could not be put in place."); }
  }
  let wall: { close(): Promise<void> } | undefined;
  try {
    let plan = planned;
    if (planned.openWall) {
      const where = workOf(planned.dataDir, launch.cwd);
      const watch = o.onEgress && where ? egressSampler(where, o.onEgress) : undefined;
      const opened = await planned.openWall(rule ? wallEgressOfRule(rule) : wallEgress(), watch);
      wall = opened;
      plan = { ...planned, sandbox: opened.sandbox };
    }
    // The engine's home is always the person's scratch home: the CLI keeps its sessions there (Claude Code ~/.claude/projects, Codex ~/.codex/sessions, Grok ~/.grok/sessions), and a chat resumes
    // them after a restart (cli-sessions.ts). An empty home per process would lose them between Codex and Grok turns. Sign-in files placed there are still removed when the process ends.
    const base = launcherEnv();
    const access = asked ? withSudoShim(accessHere(planned.dataDir, launch.cwd, asked), planned.dataDir, launch.cwd) : undefined;
    const proc = await createLocalLauncher({ wrap: (o.wrapOf ?? sandboxWrap)(plan, { homeFromScratch: true, ...(access ? { access, ...(base["PATH"] ? { basePath: base["PATH"] } : {}) } : {}) }), baseEnv: base }).spawn({ ...launch, env, argv });
    if (placed) { const p = placed; const end = (): void => settleSignin(p, signinBack); void proc.exited.then(end, end); }
    if (wall) { const w = wall; const end = (): void => { void w.close().catch(() => undefined); }; void proc.exited.then(end, end); }
    return proc;
  } catch (e) { placed?.release(); await wall?.close().catch(() => undefined); throw e; }
}

/**
 * What the engine may touch on this machine (engine-access.ts), from what the Space decided (the place, the person's folders) and what only this machine knows: its home, its data folder, which of
 * the folders are here, the SSH agent. A server's toolbox is made on first use and kept, so what an agent installs for the Space is there the next turn.
 */
export function accessHere(dataDir: string, cwd: string | undefined, asked: AccessAsked, o: { home?: string; platform?: NodeJS.Platform; sshAuthSock?: string | undefined } = {}): EngineAccess {
  const real = (p: string): string => { try { return fs.realpathSync(p); } catch { return p; } };
  const data = real(dataDir);
  const where = workOf(dataDir, cwd);
  const own = [...(cwd ? [cwd] : []), ...(where ? [scratchFolder(dataDir, where.person)] : [])];
  const toolbox = path.join(data, "toolbox");
  if (asked.where === "server") fs.mkdirSync(toolbox, { recursive: true });
  const platform = o.platform ?? process.platform;
  // Windows OpenSSH's agent answers on its named pipe whether or not SSH_AUTH_SOCK names it
  const sock = Object.hasOwn(o, "sshAuthSock") ? o.sshAuthSock : process.env["SSH_AUTH_SOCK"] ?? (platform === "win32" ? WIN_SSH_AGENT_PIPE : undefined);
  return engineAccess({
    where: asked.where, home: o.home ?? os.homedir(), dataDir: data, platform, folders: asked.folders.filter((f) => fs.existsSync(f)).map(real), own, toolbox,
    ...(asked.where === "own" && sock ? { sshAuthSock: sock } : {}), exists: fs.existsSync,
  });
}

/**
 * The `sudo` an engine finds first on its PATH: administrator rights never pass silently (owner ruling 3 Nov), so it says how to hand the command to the person instead, through the Terminal card
 * (terminal_request: "Run in my terminal", Copy, Decline). It exits 126, the shell's "cannot run", so a script stops there rather than going on without the step.
 */
export const SUDO_SHIM = `#!/bin/sh
echo "sudo: AI tools in Vyre do not get administrator rights. Ask the person to run it: call the terminal_request tool with command \\"sudo $*\\" and why it is needed; they can run it in their terminal with one click." >&2
exit 126
`;

/** The same answer for cmd.exe and PowerShell on Windows. */
export const SUDO_CMD_SHIM = "@echo off\r\necho sudo: AI tools in Vyre do not get administrator rights. Ask the person to run it: call the terminal_request tool with command \"sudo %*\" and why it is needed; they can run it in their terminal with one click. 1>&2\r\nexit /b 126\r\n";

export function withSudoShim(a: EngineAccess, dataDir: string, cwd: string | undefined, platform: NodeJS.Platform = process.platform): EngineAccess {
  const who = workOf(dataDir, cwd);
  if (!who) return a;
  const bin = path.join(scratchFolder(dataDir, who.person), "bin");
  fs.mkdirSync(bin, { recursive: true });
  for (const name of ["sudo", "doas"]) fs.writeFileSync(path.join(bin, name), SUDO_SHIM, { mode: 0o755 });
  // Windows: cmd.exe and PowerShell find sudo.cmd before Windows' own sudo.exe when this folder is first on PATH; Git Bash runs the script above
  if (platform === "win32") for (const name of ["sudo", "doas"]) fs.writeFileSync(path.join(bin, `${name}.cmd`), SUDO_CMD_SHIM);
  return { ...a, pathAdd: [bin, ...a.pathAdd] };
}

/** The spawn as the opener hands it on, with what the engine may touch (the place and the person's folders) set last, like the rule. */
export function withAccess(spec: LaunchSpec, asked: AccessAsked): LaunchSpec {
  return { ...spec, env: { ...spec.env, [ACCESS_ENV]: JSON.stringify(asked) } };
}

/** Where an engine process went on the network: one call per host and verdict per process (at most 40 of each), with the person and thread of its work folder. */
export type EgressWatch = (where: { person: string; threadId: string }, e: EgressEvent) => void;

/** The person and the thread of a work folder (sandbox.ts workParts: `<dataDir>/work/<person>/<thread>`, or the short Windows layout), or null for any other folder. */
function workOf(dataDir: string, cwd: string | undefined): { person: string; threadId: string } | null {
  const w = workParts(dataDir, cwd);
  return w ? { person: w.person, threadId: w.threadId } : null;
}

/** One report per host, port and verdict for the life of a process, and at most 40 hosts reached and 40 refused: a turn that fetches a thousand files from one registry is one line. */
function egressSampler(where: { person: string; threadId: string }, watch: EgressWatch): (e: EgressEvent) => void {
  const seen = new Set<string>();
  const counts = { allow: 0, deny: 0 };
  return (e) => {
    if (e.host === "") return;   // a request that named no host has nothing to show
    const key = `${e.verdict} ${e.host}:${e.port}`;
    if (seen.has(key) || counts[e.verdict] >= 40) return;
    seen.add(key);
    counts[e.verdict]++;
    try { watch(where, e); } catch { /* the record must not break the engine */ }
  };
}

/** The spawn as the opener hands it on: the Space's network rule set last, so nothing filled into the environment before it (a Vault item's fields) can name another. */
export function withRule(spec: LaunchSpec, rule: EgressRule): LaunchSpec {
  return { ...spec, env: { ...spec.env, [RULE_ENV]: JSON.stringify(rule) } };
}

/**
 * The opener of a turn pinned to one of the person's servers (node-turns.ts): the same driver, account fill and MCP session as the Space's own, but the CLI engine is started on the server by `launcher`.
 * The server has no Space work folder, no native plugins and no sandbox socket for MCP: the engine works in a folder of the server's and reaches the Space's tools at the address it joined by.
 */
export function buildNodeOpener(h: OpenerHost, launcher: Launcher): SessionOpener {
  const system = roleBlocks(h.call);
  // the Space's network rule travels with the spawn to the person's computer, whose own sandbox applies it (node-cli.ts)
  const ruled: Launcher = h.egress || h.access || h.folders ? {
    ...launcher,
    spawn: async (spec) => {
      let s = h.egress ? withRule(spec, await ruleOf(h.egress)) : spec;
      // the person's own server: package locations, configs and the SSH agent there. Their added folders are on the computer they added them from, which is the Space's own (accessOf below).
      // a person's own computer in a Team Space (lane l-runson): the folders they added to Vyre from that computer, private or shared (OpenerHost.folders)
      if (h.access || h.folders) s = withAccess(s, { where: "own", folders: h.folders ? await h.folders().catch(() => []) : [] });
      return launcher.spawn(s);
    },
  } : launcher;
  return createSessionOpener({
    source: h.session.source, reportMiss: h.session.reportMiss, mcp: h.session.mcp, ...(h.own ? { own: h.own } : {}), ...(h.apiFetch ? { fetch: h.apiFetch } : {}),
    launcher: ruled, where: "device", placement: "device",
    apiContext: async (spec, input) => {
      if (spec.lean === true) return { system: [{ text: spec.agent.role ?? "", stable: true }], tools: [] };   // a one-shot (memory learning): its own system prompt and nothing else
      if (spec.tools === "none") return { system: [{ text: "You are completing one step of an automation. Answer with the result only.", stable: true }], tools: [] };
      return h.apiTools ? h.apiTools.context(spec, input) : { system: await system(spec, input), tools: [] };
    },
  });
}

/** An engine that is not installed says so by name; the sandbox's own "execvp failed" says nothing a person can act on. Throws before anything is filled or started. */
export function refuseMissingProgram(program: string, probe?: NodeCliProbe): void {
  if (program in CLI_NAME && findProgram(program, probe) === null) throw new LaunchError("engine.cli_missing", `${program} is not installed on this computer.`);
}

/** The Space's rule, or "Only the AI providers" when it cannot be read. */
async function ruleOf(e: NonNullable<OpenerHost["egress"]>): Promise<EgressRule> {
  try { return await e.rule(); } catch { return wallEgress({ mode: "providers", hosts: [] }).rule; }
}

/** The MCP bridge of one session: refused with sandbox.unavailable where the engine cannot be sandboxed (the spawn would refuse the same way), engine.mcp_unavailable when the bridge cannot open. */
export async function openBridge(plan: () => Promise<SandboxPlan>, m: { url: string; token: string }, scratch: string): Promise<Awaited<ReturnType<typeof openMcpBridge>> | null> {
  const s = (await plan()).sandbox;
  if (s.kind === "docker" || s.kind === "server") throw new SandboxError(cliSandboxCode(), s.reason ?? "this engine cannot be sandboxed on this computer");
  // a Windows Personal Space engine has the loopback (the ruling: the person's own computer): it reaches Vyre's MCP endpoint by its URL, with its session token
  if (s.kind === "lowil") return null;
  try { return s.kind === "wsl" ? await openWslMcpBridge(s.agent, m, { scratch }) : await openMcpBridge(m, { scratch }); }
  catch (e) { throw Object.assign(new Error(`the engine's link to Vyre's tools could not open: ${e instanceof Error ? e.message : String(e)}`), { code: "engine.mcp_unavailable" }); }
}

/** Builds the opener; the runtime keeps it for the life of the daemon and calls close() on shutdown. */
export function buildOpener(h: OpenerHost): SessionOpener {
  const system = roleBlocks(h.call);
  // The plan is the host's, or the default for this platform built on the first CLI turn (it starts the network wall). No plan and no default: CLI turns refuse, never run unwrapped.
  let planned: Promise<SandboxPlan> | undefined;
  const plan = (): Promise<SandboxPlan> => {
    if (h.sandbox) return Promise.resolve(h.sandbox);
    if (!h.defaultSandbox) return Promise.reject(new SandboxError("sandbox.unavailable", "no sandbox is set up for CLI engines on this computer"));
    if (planned) return planned;
    const p = h.defaultSandbox().then((built) => {
      // the Windows sandbox's agent ends when its VM stops (`wsl --shutdown`, a Windows update): the next turn builds it again
      if (built.sandbox.kind === "wsl") void built.sandbox.agent.exited.then(() => { if (planned === p) planned = undefined; });
      return built;
    }, (e: unknown) => { planned = undefined; throw e; });
    planned = p;
    return p;
  };
  const dataDir = h.sandbox?.dataDir ?? h.dataDir;
  const save = h.session.saveSignin?.bind(h.session);
  const sessions = h.sessions ?? { resume: () => null, checkpoint: () => undefined, keep: () => "" };
  const keyOf = (spec: SessionSpec) => ({ threadId: spec.threadId, agentId: spec.agent.id, person: spec.asker, driver: spec.account?.driver ?? "", ...(spec.tools === "none" ? { tools: "none" as const } : {}) });
  const opener = createSessionOpener({
    source: h.session.source,
    reportMiss: h.session.reportMiss,
    mcp: h.session.mcp,
    ...(save ? { saveSignin: save } : {}),
    ...(h.own ? { own: h.own } : {}),
    ...(h.apiFetch ? { fetch: h.apiFetch } : {}),
    launcher: {
      spawn: async (spec) => {
        const swap = spec.argv[0] !== undefined ? h.cliCommand?.[spec.argv[0]] : undefined;
        if (swap === undefined) refuseMissingProgram(spec.argv[0] ?? "", h.cliProbe);
        let ruled = h.egress ? withRule(spec, await ruleOf(h.egress)) : spec;
        const who = dataDir ? workOf(dataDir, spec.cwd) : null;
        if (h.access && who) ruled = withAccess(ruled, await h.access(who.person, "space").catch(() => ({ where: "server" as const, folders: [] })));
        return spawnCli(await plan(), ruled, swap ? [...swap, ...spec.argv.slice(1)] : ownedArgv(spec.argv, h.cliProbe), h.egress?.record ? { onEgress: h.egress.record } : {});
      },
    },
    // Behind the wall the engine cannot reach the daemon's loopback: its MCP config starts a stdio shim that talks to a unix socket in the person's scratch folder (ruling 61), a named pipe on Windows.
    // A computer that cannot sandbox the engine refuses here, before anything is opened, with the sandbox's own reason; a bridge that cannot open says so with a code of its own.
    ...(dataDir ? { mcpBridge: (m: { url: string; token: string }, spec: { asker: string }) => openBridge(plan, m, scratchFolder(dataDir, spec.asker)) } : {}),
    // before a Claude Code or Codex engine starts: the agent's skills where the CLI reads its own (refreshed before each turn by the runtime), then its plugins
    ...(dataDir && (h.pluginsNative !== false || h.skillsNative !== false) ? {
      nativePlugins: async (spec: SessionSpec, driver: "claude_code" | "codex") => {
        const work = workFolder(dataDir, spec.asker, spec.threadId, spec.agent.id);
        if (h.skillsNative !== false && spec.tools !== "none") await syncNativeSkills({ call: h.call }, driver, spec.agent.id, spec.asker, work).catch(() => undefined);
        return h.pluginsNative !== false ? nativePlugins({ call: h.call }, driver, spec.agent.id, spec.asker, work) : null;
      },
    } : {}),
    ...(dataDir ? {
      cli: {
        workFolder: (spec: SessionSpec) => workFolder(dataDir, spec.asker, spec.threadId, spec.agent.id),
        ...(h.sessions ? {
          resume: (spec: SessionSpec) => (spec.account ? sessions.resume(keyOf(spec)) : null),
          checkpoint: (spec: SessionSpec, id: string | null) => { if (spec.account) sessions.checkpoint(keyOf(spec), id); },
        } : {}),
      },
    } : {}),
    ...(dataDir ? { prepare: (spec: { agent: { id: string }; asker: string; threadId: string }) => prepareWorkFolder(h.call, dataDir, spec, h.sessions?.keep(spec.threadId) ?? "") } : {}),
    // A session with tools "none" (an automation's AI step) gets no tools and no agent role: its prompt carries everything it needs.
    apiContext: async (spec, input) => {
      if (spec.lean === true) return { system: [{ text: spec.agent.role ?? "", stable: true }], tools: [] };   // a one-shot (memory learning): its own system prompt and nothing else
      if (spec.tools === "none") return { system: [{ text: "You are completing one step of an automation. Answer with the result only.", stable: true }], tools: [] };
      return h.apiTools ? h.apiTools.context(spec, input) : { system: await system(spec, input), tools: [] };
    },
  });
  // shutdown: the sessions end (their processes are killed and waited for), then the sign-ins their CLIs refreshed are saved before the daemon closes its databases
  return { ...opener, close: async () => { await opener.close(); await signinsSettled(); } };
}
