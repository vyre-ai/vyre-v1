// "Use the sign-in on this computer" (owner decision D2, 3 Nov 2026): the Claude Code or Codex sign-in already on the person's own computer, read once when they press the button, in a
// Personal Space only, saved as the same fields a sign-in saves. Nothing is read where there is none, and a Team Space's server never reads its own disk for anyone.
import test from "node:test";
import assert from "node:assert/strict";
import { readLocalSignin } from "./local-signin.ts";
import { createProviderSignin } from "./provider-signin.ts";

const jwt = (claims: Record<string, unknown>): string => `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
const CODEX = JSON.stringify({ OPENAI_API_KEY: null, tokens: { id_token: jwt({ email: "maya@example.com", "https://api.openai.com/auth": { chatgpt_account_id: "acct-1", chatgpt_user_id: "u-1" } }), access_token: "a-1", refresh_token: "r-1" }, last_refresh: "2026-11-01T00:00:00Z" });
const CLAUDE = JSON.stringify({ claudeAiOauth: { accessToken: "sk-ant-oat01-local-access", refreshToken: "sk-ant-ort01-local-refresh", expiresAt: 1_800_000_000_000, scopes: ["user:inference"] } }); // secret-scan: fake
const disk = (files: Record<string, string>) => (p: string): string | null => files[p] ?? null;

test("codex: the auth.json `codex login` wrote, from CODEX_HOME or ~/.codex, as the file map a device sign-in saves, with the account it names", () => {
  const got = readLocalSignin("codex", { home: "/home/maya", env: {}, readFile: disk({ "/home/maya/.codex/auth.json": CODEX }) });
  assert.equal(got.state, "done");
  if (got.state !== "done") return;
  assert.deepEqual(got.fields.map((f) => [f.key, f.secret]), [["credentials", true]]);
  assert.deepEqual(JSON.parse(got.fields[0]!.value), { ".codex/auth.json": CODEX });
  assert.ok(got.identity?.id.includes("acct-1"));
  assert.equal(readLocalSignin("codex", { home: "/home/maya", env: { CODEX_HOME: "/opt/codex" }, readFile: disk({ "/opt/codex/auth.json": CODEX }) }).state, "done");
  const out = readLocalSignin("codex", { home: "/home/maya", env: {}, readFile: disk({ "/home/maya/.codex/auth.json": JSON.stringify({ OPENAI_API_KEY: "sk-x", tokens: null }) }) });
  assert.deepEqual(out, { state: "failed", message: "There is no ChatGPT (Codex) sign-in on this computer. Sign in instead." }, "an API-key file is not a sign-in");
});

test("claude: ~/.claude/.credentials.json (or CLAUDE_CONFIG_DIR), else the Mac Keychain entry; kept as the file Claude Code reads, so its own refresh writes it back", () => {
  const file = readLocalSignin("claude-code", { home: "/home/maya", env: {}, platform: "linux", readFile: disk({ "/home/maya/.claude/.credentials.json": CLAUDE }) });
  assert.equal(file.state, "done");
  if (file.state === "done") assert.deepEqual(JSON.parse(file.fields[0]!.value), { ".claude/.credentials.json": CLAUDE });
  let asked = "";
  const mac = readLocalSignin("claude-code", { home: "/Users/maya", env: {}, platform: "darwin", readFile: () => null, keychain: (s) => { asked = s; return CLAUDE; } });
  assert.equal(mac.state, "done");
  assert.equal(asked, "Claude Code-credentials");
  assert.equal(readLocalSignin("claude-code", { home: "/home/maya", env: {}, platform: "linux", readFile: () => null, keychain: () => CLAUDE }).state, "failed", "the Keychain is the Mac's only");
  assert.deepEqual(readLocalSignin("claude-code", { home: "/h", env: {}, platform: "linux", readFile: disk({ "/h/.claude/.credentials.json": "{}" }) }), { state: "failed", message: "There is no Claude Code sign-in on this computer. Sign in instead." });
  assert.equal(readLocalSignin("grok", { home: "/h", env: {}, readFile: () => null }).state, "failed");
});

test("the port uses it only when the daemon gave it a reader (a Personal Space): the flow is finished at once, with no link; elsewhere it is refused in plain words", async () => {
  const fetch = (async () => { throw new Error("no network in this test"); }) as never;
  const personal = createProviderSignin({ fetch, localSignin: () => ({ state: "done", fields: [{ key: "credentials", value: "{}", secret: true }] }) });
  const started = await personal.start({ id: "sub_l", provider: "codex", person: "usr_maya", local: true });
  assert.deepEqual(started, { url: "", needsCode: false, expiresInSec: 900 });
  assert.equal(personal.active("sub_l"), true);
  assert.equal((await personal.step({ id: "sub_l", person: "usr_maya" })).state, "done");
  assert.equal((await personal.step({ id: "sub_l", person: "usr_other" })).state, "failed", "the flow is the person's own");
  const none = createProviderSignin({ fetch, localSignin: () => ({ state: "failed", message: "There is no Claude Code sign-in on this computer. Sign in instead." }) });
  await assert.rejects(none.start({ id: "sub_n", provider: "claude-code", person: "usr_maya", local: true }), /no Claude Code sign-in on this computer/);
  const team = createProviderSignin({ fetch });
  await assert.rejects(team.start({ id: "sub_t", provider: "codex", person: "usr_maya", local: true }), /Personal Space only/);
});
