// What a command can do before it runs (rc.8): read-only (green), changes something (amber), destructive or elevated (red). The person sees the dot before a command runs; red always asks.
// It sits on the person's own rules (judge) and never loosens them: a deny rule reads red, an ask rule reads at least amber, and an allow rule never makes a risky command look safer than what it is.
import { judge, segmentsOf } from "./projections.ts";
import type { Rules, Verdict } from "./projections.ts";

export type Risk = "read" | "change" | "danger";
const RANK: Readonly<Record<Risk, number>> = { read: 0, change: 1, danger: 2 };
export const worse = (a: Risk, b: Risk): Risk => (RANK[a] >= RANK[b] ? a : b);

/** Commands that only look: no flag turns them into a change except where listed in READ_UNLESS. */
const READ = new Set([
  "ls", "ll", "cat", "pwd", "echo", "printf", "head", "tail", "wc", "grep", "egrep", "fgrep", "rg", "which", "whoami", "date", "df", "du", "ps", "uname", "env", "printenv", "hostname", "id", "file", "stat",
  "tree", "less", "more", "sort", "uniq", "diff", "cmp", "basename", "dirname", "realpath", "readlink", "uptime", "free", "top", "htop", "lsof", "ping", "dig", "nslookup", "type", "man", "history", "true", "false", "test", "cd",
]);
/** A read command that changes something with one of these (find -delete, sed -i, tee, a redirect). */
const READ_UNLESS: ReadonlyArray<[string, RegExp]> = [["find", /\s-(delete|exec|execdir|ok)\b/], ["sort", /\s-o\b/], ["tee", /./], ["sed", /\s-i\b/]];
const GIT_READ = new Set(["status", "log", "diff", "show", "branch", "remote", "blame", "describe", "rev-parse", "ls-files", "config", "tag", "stash list", "shortlog"]);
const SUB_READ: Readonly<Record<string, ReadonlySet<string>>> = {
  npm: new Set(["ls", "list", "view", "outdated", "audit", "-v", "--version", "config"]), pnpm: new Set(["ls", "list", "why", "outdated", "-v"]), yarn: new Set(["list", "why", "info", "-v"]),
  node: new Set(["-v", "--version", "-p"]), docker: new Set(["ps", "images", "logs", "inspect", "version", "info", "stats", "top", "port", "diff", "history"]), kubectl: new Set(["get", "describe", "logs", "top", "version", "explain", "config"]),
  systemctl: new Set(["status", "list-units", "is-active", "is-enabled", "show"]), brew: new Set(["list", "info", "search", "outdated", "--version"]), pip: new Set(["list", "show", "freeze", "--version"]), cargo: new Set(["--version", "tree", "metadata"]),
};

const DANGER: ReadonlyArray<RegExp> = [
  /(^|[\s;&|])sudo\b/, /(^|[\s;&|])su(\s|$)/, /(^|[\s;&|])doas\b/,
  /\brm\s+(-[a-zA-Z]*[rRf][a-zA-Z]*|--recursive|--force)\b/, /\brm\s+([^|;&]*\s)?(\/|~|\$HOME)(\s|$)/,
  /\bdd\s+[^|;&]*\bof=/, /\bmkfs(\.\w+)?\b/, /\bfdisk\b|\bparted\b|\bwipefs\b|\bshred\b/,
  /\b(shutdown|reboot|halt|poweroff|init\s+[06])\b/,
  /\b(chmod|chown|chgrp)\s+[^|;&]*-[a-zA-Z]*R/, /\bchmod\s+(-\w+\s+)?[0-7]*777\b/,
  /\bgit\s+push\b[^|;&]*(--force\b|--force-with-lease\b|\s-f\b)/, /\bgit\s+reset\s+--hard\b/, /\bgit\s+clean\s+-[a-zA-Z]*f/, /\bgit\s+(checkout|restore)\s+(--\s+)?\.(\s|$)/,
  /\b(drop\s+(database|table|schema)|truncate\s+table)\b/i,
  /\bdocker\s+(system\s+prune|volume\s+(rm|prune)|rm\s+-f|rmi\s+-f)\b/, /\bkubectl\s+(delete|drain|cordon)\b/,
  /\b(curl|wget)\b[^|;&]*\|\s*(sudo\s+)?(ba|z|da)?sh\b/, /:\(\)\s*\{/,
  />\s*\/dev\/(sd|nvme|disk|hd)/, /\b(iptables|ufw|nft)\b/, /\bcrontab\s+-r\b/, /\bpasswd\b|\bvisudo\b|\buserdel\b|\bdeluser\b/,
  /\bkill\s+-9\s+(-1|1)\b|\bkillall\b|\bpkill\s+-9\b/, /\bsystemctl\s+(stop|disable|mask)\b/, /\bnpm\s+publish\b|\bcargo\s+publish\b/,
];

const words = (p: string): string[] => p.trim().split(/\s+/).filter((x) => x !== "");

/** The risk of one simple command (no pipes or lists). */
function partRisk(p: string): Risk {
  const w = words(p);
  // leading VAR=value assignments and `env`/`command`/`time` wrappers do not change what the command is
  while (w.length > 0 && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0]!) || ["env", "command", "time", "nice", "nohup"].includes(w[0]!))) w.shift();
  const first = w[0];
  if (first === undefined) return "read";
  // a redirect to a file is a write; /dev/null is not
  if (/(^|[^>&0-9])>{1,2}\s*(?!\/dev\/null\b|&)\S/.test(p)) return "change";
  const unless = READ_UNLESS.find(([n]) => n === first);
  if (unless && unless[1].test(p)) return "change";
  if (READ.has(first)) return "read";
  if (first === "git") {
    const sub = w.slice(1).find((x) => !x.startsWith("-")) ?? "";
    return GIT_READ.has(sub) && !(sub === "branch" && /\s-[dDmM]\b|\s--(delete|move)\b/.test(p)) && !(sub === "tag" && /\s-[dfa]\b/.test(p)) && !(sub === "config" && !/--(get|list)\b|-l\b/.test(p)) ? "read" : "change";
  }
  const reads = SUB_READ[first];
  if (reads && reads.has(w.find((x, i) => i > 0 && (!x.startsWith("-") || x === "-v" || x === "--version")) ?? "")) return "read";
  return "change";
}

/** The risk of a command line: the worst of its parts, and red when any pattern of the destructive list shows anywhere in it (a pipe into a shell, a forced push). */
export function riskOf(command: string): Risk {
  const whole = command.trim();
  if (whole === "") return "read";
  if (DANGER.some((re) => re.test(whole))) return "danger";
  return segmentsOf(whole).reduce<Risk>((r, p) => worse(r, partRisk(p)), "read");
}

export interface Judged { risk: Risk; verdict: Verdict["verdict"]; entry?: string; why: string }

/**
 * What the person is shown for a command, over their rules. A deny rule is red and stays denied. An ask rule reads at least amber. Red always asks: an allow rule, or no rule, still ends in "ask".
 * Nothing here turns a deny or an ask into an allow.
 */
export function judged(rules: Rules, command: string): Judged {
  const base = riskOf(command);
  const v = judge(rules, command);
  if (v.verdict === "deny") return { risk: "danger", verdict: "deny", ...(v.entry === undefined ? {} : { entry: v.entry }), why: "A rule of yours never allows it" };
  const risk = v.verdict === "ask" ? worse(base, "change") : base;
  if (risk === "danger") return { risk, verdict: "ask", ...(v.entry === undefined ? {} : { entry: v.entry }), why: "Destructive or elevated: always asks" };
  return { risk, verdict: v.verdict, ...(v.entry === undefined ? {} : { entry: v.entry }), why: risk === "read" ? "Only reads" : "Changes something" };
}

/** The Gate's condition on terminal.run: an agent's red command is held for a yes, in every mode. */
export const isDangerous = (command: string): boolean => riskOf(command) === "danger";
