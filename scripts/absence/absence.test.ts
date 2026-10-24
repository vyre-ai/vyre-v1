import test from "node:test";
import assert from "node:assert/strict";
import { RULES, checkAbsence, checkAdrIndex, formatFindings, importSpecifiers, inScope } from "./absence.ts";

function rulesHit(path: string, text?: string): string[] {
  const file = text === undefined ? { path } : { path, text };
  return checkAbsence([file]).map((f) => f.rule);
}

test("every excluded item has a rule", () => {
  assert.deepEqual(RULES.map((r) => r.id).sort(), ["autofill", "billing", "lumen", "mac-windows-control", "passkeys", "voice-agents"]);
});

test("fails when a forbidden path is imported: Lumen, Mac/Windows control, voice, billing, AutoFill, passkeys", () => {
  const cases: [string, string, string][] = [
    ["lumen", "import { open } from '../lumen/client.ts';", "lumen"],
    ["mac-windows-control", "import { click } from '../../local/hands-mac/click.ts';", "mac-windows-control"],
    ["mac-windows-control", "import x from 'local/hands-windows';", "mac-windows-control"],
    ["voice-agents", "import { answer } from './voice-agent/answer.ts';", "voice-agents"],
    ["voice-agents", "import { Client } from '@elevenlabs/client';", "voice-agents"],
    ["voice-agents", "const m = await import('./meeting-bot.ts');", "voice-agents"],
    ["billing", "import { plan } from '../billing/plan.ts';", "billing"],
    ["autofill", "import { provider } from './autofill/provider.ts';", "autofill"],
    ["passkeys", "import { create } from '@simplewebauthn/browser';", "passkeys"],
    ["passkeys", "export * from './vault-apple/index.ts';", "passkeys"],
    ["passkeys", "const p = require('react-native-passkey');", "passkeys"],
  ];
  for (const [rule, text, expected] of cases) {
    const found = checkAbsence([{ path: "modules/vault/impl.ts", text }]);
    assert.ok(found.some((f) => f.rule === expected && f.kind === "import"), `${rule}: ${text}`);
  }
  const lines = formatFindings(checkAbsence([{ path: "modules/vault/impl.ts", text: "import '../lumen/x.ts';" }]));
  assert.match(lines[0] ?? "", /not-in-v1 lumen: modules\/vault\/impl\.ts imports "\.\.\/lumen\/x\.ts"/);
});

test("fails on a forbidden path even when nothing imports it", () => {
  for (const path of ["local/hands-mac/index.ts", "modules/voice-agent/index.ts", "apps/app/src/passkey/create.tsx", "modules/billing/plans.ts", "client/src/autofill.ts", "modules/lumen/index.ts", "apps/app/vault-android/x.ts", "modules/meeting-bot/join.ts"]) {
    assert.ok(rulesHit(path).length > 0, path);
    assert.ok(checkAbsence([{ path }]).every((f) => f.kind === "path"), path);
  }
});

test("passes what is in v1: Softphone, Stripe connector, plain words that only contain a forbidden one", () => {
  const clean: [string, string][] = [
    ["ui/src/Softphone/index.tsx", "import { Device } from '@twilio/voice-sdk';"],
    ["connectors/stripe/transforms.js", "export const invoices = 1;"],
    ["modules/telephony/voicemail.ts", "import './ingest-voice.ts';"],
    ["modules/records/rebilling-note.ts", "import './seatsmap.ts';"],
    ["modules/vault/fill.ts", "import { fill } from '../../client/src/fill.ts';"],
    ["modules/identity/signin.ts", "import { hash } from '../../lib/hash.ts';"],
  ];
  for (const [path, text] of clean) assert.deepEqual(checkAbsence([{ path, text }]), [], path);
});

test("frozen contract text, docs and this check's own files are out of scope", () => {
  for (const path of ["generated/docs/capabilities/identity.passkey_register.md", "manifests/identity.ts", "packages/contracts/src/passkey.ts", "docs/spec/V1-SPEC.md", "scripts/absence/absence.test.ts", "modules/lumen/README.md"]) {
    assert.equal(inScope(path), false, path);
    assert.deepEqual(checkAbsence([{ path, text: "import '../lumen/x.ts';" }]), [], path);
  }
  assert.equal(inScope("modules/vault/impl.ts"), true);
});

test("importSpecifiers reads static, export-from, side-effect, dynamic and require forms", () => {
  const text = "import a from './a.ts';\nimport type { B } from \"./b.ts\";\nexport * from './c.ts';\nimport './d.ts';\nconst e = await import('./e.ts');\nconst f = require('./f.cjs');";
  assert.deepEqual(importSpecifiers(text).sort(), ["./a.ts", "./b.ts", "./c.ts", "./d.ts", "./e.ts", "./f.cjs"]);
});

test("ADR index: lists every file, no gaps, no dead links, names checked", () => {
  const index = "| [0001](0001-first.md) | a |\n| [0002](0002-second.md) | b |";
  assert.deepEqual(checkAdrIndex({ files: ["README.md", "0001-first.md", "0002-second.md"], index }), []);
  assert.ok(checkAdrIndex({ files: ["README.md", "0001-first.md", "0002-second.md", "0003-third.md"], index }).some((e) => e.includes("0003-third.md is not linked")));
  assert.ok(checkAdrIndex({ files: ["README.md", "0001-first.md"], index }).some((e) => e.includes("links 0002-second.md, which does not exist")));
  assert.ok(checkAdrIndex({ files: ["README.md", "0001-first.md", "0003-third.md"], index: index + "\n[0003](0003-third.md)" }).some((e) => e.includes("without gaps")));
  assert.ok(checkAdrIndex({ files: ["README.md", "notes.md"], index: "" }).some((e) => e.includes("not named NNNN")));
});
