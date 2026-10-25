// The `vyre` and `vyre-server` commands (ARCH 7.10, 12.3). A thin client: nearly every command is a row of the generated table calling one capability on the running daemon, so the terminal, the
// Console and an agent can never disagree about what a command does. Hand-written: `server` (run the daemon), `doctor` (works with the server down), `run --env` (Vault into one child process),
// and `connector` (friendly words and following a build). `vyre help` lists them all.
import { fileURLToPath } from "node:url";
import { parseArgs } from "./args.ts";
import { callCap, NotRunning, notRunningHint, resolveTarget, showError } from "./client.ts";
import { connectorBooleans, connectorCommand } from "./connector.ts";
import { EXIT, errLine, line, processIo } from "./io.ts";
import type { CliIo } from "./io.ts";
import { runEnv } from "./runenv.ts";
import { doctorCommand, serverCommand } from "./server.ts";
import { booleanFlags, buildInput, capInfo, commandRows, helpFor, resolveRow } from "./table.ts";

export { EXIT } from "./io.ts";
export type { CliIo } from "./io.ts";

const HAND: { name: string; summary: string }[] = [
  { name: "server", summary: "start, stop, restart, status or logs of the daemon on this machine" },
  { name: "doctor", summary: "check this server; works with the server down (--offline forces the local check)" },
  { name: "run --env <folder> -- <cmd>", summary: "run a command with a Vault folder in its environment only" },
  { name: "connector <init|build|test|run|publish|export|list>", summary: "work on connectors" },
  { name: "help", summary: "this list, or help <command>" },
];

export function helpText(program: string): string {
  const tableRows = commandRows().filter((r) => r.words[0] !== "doctor" && r.words[0] !== "run");
  const groups = new Map<string, string[]>();
  for (const r of tableRows) {
    const g = r.words[0] ?? "";
    const info = capInfo(r.cap, r.v);
    groups.set(g, [...(groups.get(g) ?? []), `  ${r.command.padEnd(34)} ${info?.summary ?? ""}`]);
  }
  return [
    `${program} commands`, "",
    ...HAND.map((h) => `  ${(program + " " + h.name).padEnd(34)} ${h.summary}`), "",
    ...[...groups].sort(([a], [b]) => a.localeCompare(b)).flatMap(([, rows]) => rows), "",
    `${program} help <command> shows a command's fields. --json prints raw output.`, "",
  ].join("\n");
}

export async function main(argv: readonly string[], io: CliIo = processIo(), program: "vyre" | "vyre-server" = "vyre"): Promise<number> {
  let args = [...argv];
  if (program === "vyre-server" && args[0] && !["server", "help", "--help", "-h"].includes(args[0])) args = ["server", ...args];
  const pre = parseArgs(args, new Set(["json", "help", "offline", "env-flag"]));
  const head = pre.positional[0];

  if (head === undefined || head === "help" || (pre.flags.has("help") && pre.positional.length === 0)) {
    if (head === "help" && pre.positional.length > 1) return helpOne(io, pre.positional.slice(1), pre.flags);
    io.out(helpText(program));
    return head === undefined && !pre.flags.has("help") ? EXIT.USAGE : EXIT.OK;
  }
  if (head === "server") return serverCommand(io, args.slice(args.indexOf("server") + 1));
  if (head === "doctor") return doctorCommand(io, parseArgs(args.slice(args.indexOf("doctor") + 1), new Set(["json", "offline"])), { alwaysOffline: false });
  if (head === "connector" && (pre.positional[1] !== undefined)) return connectorCommand(io, parseArgs(args, connectorBooleans));
  if (head === "run" && pre.flags.has("env")) return runEnv(io, parseArgs(args.slice(args.indexOf("run") + 1), new Set(["json"])));

  const found = resolveRow(pre.positional, pre.flags);
  if (!found) {
    errLine(io, `${program} ${pre.positional.slice(0, 2).join(" ")}: not a command. ${program} help lists them.`);
    return EXIT.USAGE;
  }
  const info = capInfo(found.row.cap, found.row.v);
  if (!info) { errLine(io, `${found.row.command}: its capability ${found.row.cap} is not in this build`); return EXIT.FAILED; }
  const parsed = parseArgs(args, booleanFlags(info));
  if (parsed.flags.has("help")) { io.out(helpFor(found.row, info)); return EXIT.OK; }
  const built = buildInput(info, parsed, found.used, () => `idem_${Array.from(globalThis.crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("")}`);
  if (!built.ok) {
    for (const p of built.problems) errLine(io, p);
    errLine(io, `${program} help ${found.row.words.join(" ")}`);
    return EXIT.USAGE;
  }
  const target = resolveTarget(io, parsed.flags);
  if (!target) { errLine(io, "No server or token found. Use --server and --token, or run on the server's own machine."); return EXIT.USAGE; }
  try {
    const r = await callCap(io, target, found.row.cap, built.input, found.row.v);
    if (!r.ok) return showError(io, r);
    if (typeof r.data === "string") line(io, r.data);
    else line(io, JSON.stringify(r.data, null, parsed.flags.has("json") && !io.tty ? 0 : 2));
    return EXIT.OK;
  } catch (e) {
    if (e instanceof NotRunning) { errLine(io, `${e.message}. ${notRunningHint}`); return EXIT.NOT_RUNNING; }
    throw e;
  }
}

function helpOne(io: CliIo, words: string[], flags: ReadonlyMap<string, string | true>): number {
  const found = resolveRow(words, flags);
  if (!found) {
    const hand = HAND.find((h) => h.name.split(" ")[0] === words[0]);
    if (hand) { line(io, `${hand.name}\n${hand.summary}`); return EXIT.OK; }
    errLine(io, `${words.join(" ")}: not a command`);
    return EXIT.USAGE;
  }
  io.out(helpFor(found.row, capInfo(found.row.cap, found.row.v)));
  return EXIT.OK;
}

// run as a program (`node host/src/cli/index.ts ...`); the installer's `vyre` and `vyre-server` shims set VYRE_PROGRAM
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main(process.argv.slice(2), processIo(), process.env["VYRE_PROGRAM"] === "vyre-server" ? "vyre-server" : "vyre");
}
