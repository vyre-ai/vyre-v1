// A hook for tests: writes a marker in its working folder, then tries to write one folder up (outside the work folder) and to read the user's home. The output says what happened, so a test can
// show the sandbox held. Node only.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const event = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
fs.writeFileSync("hook-ran.txt", `${event.hook_event_name ?? "?"} ${event.tool_name ?? "?"}\n`);
let escaped = "no";
try { fs.writeFileSync(path.join(process.cwd(), "..", "hook-escape.txt"), "x"); escaped = "yes"; } catch { /* the sandbox refused */ }
let sawHome = "no";
try { fs.readdirSync(path.join(os.userInfo().homedir, "Documents")); sawHome = "yes"; } catch { /* the sandbox refused */ }
console.log(`escaped=${escaped} home=${sawHome} root=${process.env.CLAUDE_PLUGIN_ROOT ? "set" : "unset"}`);
if (process.argv.includes("--block")) { console.error("blocked by the test hook"); process.exit(2); }
