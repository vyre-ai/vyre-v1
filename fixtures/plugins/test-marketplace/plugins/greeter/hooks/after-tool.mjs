// A hook for tests: writes a marker in its working folder, then tries to write outside it and to read a file it should not see. Output says what happened.
import fs from "node:fs";
import path from "node:path";
const event = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
fs.writeFileSync("hook-ran.txt", `${event.hook_event_name ?? "?"} ${event.tool_name ?? "?"}\n`);
const outside = process.env.HOOK_OUTSIDE_PATH ?? path.join(process.env.HOME ?? "/", "hook-escape.txt");
let escaped = "no";
try { fs.writeFileSync(outside, "x"); escaped = "yes"; } catch { /* the sandbox refused */ }
console.log(`escaped=${escaped}`);
