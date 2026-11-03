// Launch an exe from node and print its page probe line. mode: clean (no VYRE_* env, stdio ignore/pipe/pipe, as update-proof.ts) or heavy (as shell.heavy.test.ts: VYRE_SHELL_BANNER=1, default stdio).
import { spawn } from "node:child_process";
const [exe, mode] = process.argv.slice(2);
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("VYRE_")));
if (mode === "heavy") env.VYRE_SHELL_BANNER = "1";
if (mode === "clean-off") env.VYRE_NO_AUTO_UPDATE = "1";
const child = spawn(exe, [], mode === "heavy" ? { env } : { env, stdio: ["ignore", "pipe", "pipe"] });
let out = "";
child.stdout.on("data", (c) => { out += c; }); child.stderr.on("data", (c) => { out += c; });
await new Promise((r) => setTimeout(r, 25000));
console.log(`launch ${mode}: ` + (out.split("\n").filter((l) => /page rendered|page error|sidecar ready|update:/.test(l)).join(" || ") || "(no probe line)"));
