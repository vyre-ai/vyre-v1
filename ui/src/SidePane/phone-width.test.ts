// One phone width for the whole app: a window narrower than 768 is a phone (layout.ts: PHONE_BELOW, isPhoneWidth, belowPhone). A new hard-coded 640, 700, 720 or 760 phone check fails here; use the token.
// @reads /apps/app/src
// @reads /ui/src
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../../..");
/** Container widths (a pane or a canvas measured by onLayout, not the window) and non-width numbers keep their own thresholds. */
const CONTAINER = new Set([
  "apps/app/src/places/files/memory/MemoryGraph.tsx", "apps/app/src/places/files/memory/model.ts", "apps/app/src/machines/MachinesView.tsx",
  "apps/app/src/places/chats/conversation/Conversation.tsx", "apps/app/src/console/pages/integration-object.tsx", "apps/app/src/console/pages/comms/common.tsx",
  "apps/app/src/onboarding/OnboardingScreen.tsx",
]);
const BAD = /\b(?:width|winW|w|innerWidth|\.width)\s*(?:<=?|>=?)\s*(?:640|700|720|760)\b/;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== "generated") walk(p, out); } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
  }
  return out;
}

test("no hard-coded phone width (640, 700, 720, 760) outside the layout model", () => {
  const found: string[] = [];
  for (const f of [...walk(path.join(ROOT, "apps/app/src")), ...walk(path.join(ROOT, "ui/src"))]) {
    const rel = path.relative(ROOT, f);
    if (CONTAINER.has(rel)) continue;
    fs.readFileSync(f, "utf8").split("\n").forEach((line, i) => { if (BAD.test(line)) found.push(`${rel}:${i + 1}: ${line.trim().slice(0, 100)}`); });
  }
  assert.deepEqual(found, [], "use isPhoneWidth or belowPhone from ui/src/SidePane/layout.ts");
});
