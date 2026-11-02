// Every way into a Space registers this device the same way: the desktop app as "Vyre desktop", a browser by what it says it is.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deviceFor } from "./logic.ts";

test("the desktop app is Vyre desktop; a browser is named from its user agent, or Web browser when it says nothing", () => {
  assert.deepEqual(deviceFor("desktop", "Mozilla/5.0 (Macintosh) AppleWebKit Safari/605"), { deviceName: "Vyre desktop", deviceClass: "desktop" });
  assert.deepEqual(deviceFor("web", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) AppleWebKit Version/18.0 Mobile Safari/604.1"), { deviceName: "Safari on iPhone", deviceClass: "web" });
  assert.deepEqual(deviceFor("web", "Mozilla/5.0 (Macintosh) AppleWebKit Chrome/140 Safari/537.36"), { deviceName: "Chrome on Mac", deviceClass: "web" });
  assert.deepEqual(deviceFor("web", "curl/8"), { deviceName: "Web browser", deviceClass: "web" });
});

test("no way in names its device by hand: sign-in, join, claim, reset and recovery all go through deviceFor", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const files = ["../shell/session/SessionGate.tsx", "../shell/session/desktop.ts", "../claim/ClaimRoute.tsx", "./reset.ts", "./recover.ts"].map((f) => path.join(here, f));
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    assert.doesNotMatch(src, /["']Web browser["']/, `${path.basename(f)} names a browser by hand`);
    assert.doesNotMatch(src, /deviceName:\s*["']Vyre desktop["']/, `${path.basename(f)} names the desktop app by hand`);
    assert.match(src, /deviceFor\(/, `${path.basename(f)} uses deviceFor`);
  }
});
