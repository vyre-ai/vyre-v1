// A Space is never called by its id: the label falls back to the address, and no screen puts a Space id where a person reads it (the owner: "Should show name of the space and not ID").
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SPACE_ID, spaceHost, spaceLabel } from "./space-label.ts";
import { signInInvite } from "../session/SessionGate.tsx";

test("a Space's label is its name, else its address, never its id", () => {
  assert.equal(spaceLabel("MLA", "https://mla.vyre.run"), "MLA");
  assert.equal(spaceLabel("spc_2a7c98c337e1dfd2e05e1aab", "https://mla.vyre.run"), "mla.vyre.run");
  assert.equal(spaceLabel("  ", "https://mla.vyre.run:443/"), "mla.vyre.run");
  assert.equal(spaceLabel(undefined, "mla.vyre.run"), "mla.vyre.run");
  assert.equal(spaceLabel("spc_x", ""), "your Space");
  assert.equal(spaceHost("http://127.0.0.1:4100"), "127.0.0.1");
});

test("the sign-in screen names the Space, or its address when the server answers an id", () => {
  const opts = { fingerprint: "", password: true, github: false, sso: [], secondFactorRequired: false };
  assert.equal(signInInvite("https://mla.vyre.run", { ...opts, name: "spc_2a7c98c337e1dfd2e05e1aab" }).space, "mla.vyre.run");
  assert.equal(signInInvite("https://mla.vyre.run", { ...opts, name: "My Legal Academy" }).space, "My Legal Academy");
  assert.equal(signInInvite("https://mla.vyre.run", null).space, "mla.vyre.run");
});

// ---- lint: no UI string carries a Space id

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
function sources(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== "shots") sources(p, out); }
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.(ts|tsx)$/.test(e.name) && !/sample/.test(e.name)) out.push(p);
  }
  return out;
}
/** An expression that is a Space id: spaceId, def.spaceId, space.id, ctx.spaceId and the like. */
const ID = String.raw`(?<![\w$.])(?:[A-Za-z_$][\w$]*\??\.)*(?:spaceId|space\??\.id)\b`;
const RULES: { why: string; re: RegExp }[] = [
  // prose with a Space id in it: a template literal with a space in its text and a Space id interpolated
  { why: "a sentence interpolates a Space id", re: new RegExp(String.raw`\`[^\`]*\s[^\`]*\$\{\s*${ID}\s*\}[^\`]*\`|\`[^\`]*\$\{\s*${ID}\s*\}[^\`]*\s[^\`]*\``) },
  // a Space id drawn as text
  { why: "JSX draws a Space id", re: new RegExp(String.raw`>\s*\{\s*${ID}\s*\}\s*<`) },
  // a Space id handed to a prop a person reads
  { why: "a title, label, name or sub is a Space id", re: new RegExp(String.raw`(?<!\b(?:const|let|var)\s+)\b(?:title|label|sub|name|space|spaceName|placeholder)\s*[=:]\s*\{?\s*${ID}\s*[}),;]`) },
  // a name that falls back to the id
  { why: "a name falls back to a Space id", re: new RegExp(String.raw`[nN]ame\s*(?:\?\?|\|\|)\s*${ID}\b`) },
];

test("lint: no screen shows a Space id where a person reads it", () => {
  const found: string[] = [];
  for (const file of sources(ROOT)) {
    const text = fs.readFileSync(file, "utf8");
    for (const [i, line] of text.split("\n").entries()) {
      if (/^\s*(\/\/|\*)/.test(line)) continue;
      for (const r of RULES) if (r.re.test(line)) found.push(`${path.relative(ROOT, file)}:${i + 1}: ${r.why}`);
    }
  }
  assert.deepEqual(found, [], "Show the Space's name (spaces/space-label.ts spaceLabel), never its id");
});

test("lint: the rule catches what it is for", () => {
  const hits = (line: string): boolean => RULES.some((r) => r.re.test(line));
  assert.ok(hits("const t = `Sign in to ${def.spaceId}`;"));
  assert.ok(hits("<Text>{space.id}</Text>"));
  assert.ok(hits("title={stored.def.spaceId}"));
  assert.ok(hits("const shown = name ?? spaceId;"));
  assert.ok(!hits("const key = `vyre.tabs.v1:${deviceId}:${spaceId}`;"), "a storage key is not prose");
  assert.ok(!hits("const space = session.def.spaceId;"), "a variable that holds the id is not a label");
  assert.ok(SPACE_ID.test("spc_2a7c98c337e1dfd2e05e1aab"));
});
