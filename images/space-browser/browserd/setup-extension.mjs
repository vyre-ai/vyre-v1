// Run once at image build: works out the id Chromium gives Vyre for Chrome, pins it in the toolbar by managed policy, and registers the native messaging host `run.vyre.bridge` for that id, so the
// extension can talk to browserd (bridge.ts). An unpacked extension with a `key` in its manifest (apps/chrome has one) gets its id from the key; one without gets it from its path. The id is the first
// 32 hex digits of the SHA-256 of the DER public key (or of the path), each digit written as a letter from a to p.
import crypto from "node:crypto";
import fs from "node:fs";

const DIR = "/opt/vyre-chrome";
// the start page of every profile (browserd/start.ts): the home page and the new tab; the first tab goes there when the browser starts
const START = "http://127.0.0.1:7004/start";
const idOf = (bytes) => [...crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
let key = null;
let has = false;
try {
  const m = JSON.parse(fs.readFileSync(`${DIR}/manifest.json`, "utf8"));
  has = true;
  key = typeof m.key === "string" ? m.key : null;
  // In a person's Chrome the debugger permission is optional: the person grants it when they open Chrome to an agent, and the agent control (apps/chrome/src/agent/index.js) starts only then. Nobody can
  // click that in a browser with no screen, and this browser is the agent's own, so the build's copy of the manifest holds it from the start. The id comes from the key, which is not touched.
  const optional = Array.isArray(m.optional_permissions) ? m.optional_permissions : [];
  if (optional.includes("debugger")) {
    m.optional_permissions = optional.filter((p) => p !== "debugger");
    m.permissions = [...(Array.isArray(m.permissions) ? m.permissions : []), "debugger"];
    fs.writeFileSync(`${DIR}/manifest.json`, JSON.stringify(m, null, 2));
  }
} catch { /* the placeholder: no extension in this build */ }
const id = key ? idOf(Buffer.from(key, "base64")) : idOf(Buffer.from(DIR));
fs.mkdirSync("/etc/chromium/policies/managed", { recursive: true });
// RestoreOnStartup 1: a profile's browser that stopped after idle opens the tabs it had (owner, 6 Nov: "its own cookies, logins, tabs"). URLBlocklist: no page and no tool opens a file of the container
// (every profile's folder, its bridge token among them, is readable by the one user all the browsers run as).
fs.writeFileSync("/etc/chromium/policies/managed/vyre.json", JSON.stringify({ BrowserSignin: 0, SyncDisabled: true, PromptForDownloadLocation: false, HomepageLocation: START, HomepageIsNewTabPage: false, NewTabPageLocation: START, ShowHomeButton: false, RestoreOnStartup: 1, URLBlocklist: ["file://*"], ExtensionSettings: { [id]: { toolbar_pin: "force_pinned" } } }));
if (has) {
  fs.mkdirSync("/etc/chromium/native-messaging-hosts", { recursive: true });
  fs.writeFileSync("/etc/chromium/native-messaging-hosts/run.vyre.bridge.json", JSON.stringify({
    name: "run.vyre.bridge", description: "Vyre for Chrome talks to the Space browser through this host.", path: "/opt/browserd/bridge-host", type: "stdio", allowed_origins: [`chrome-extension://${id}/`],
  }));
}
console.log(`vyre for chrome id ${id}${has ? " (native host registered)" : " (no extension in this build)"}`);
