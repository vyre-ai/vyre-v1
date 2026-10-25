// Vyre for Chrome inside an agent's computer (V1-SPEC 3.12 "In the agent's computer" and "Learned recipes", 2.7, ARCH 7.12): the agent token sees only the agent's items, a person's
// operations do not exist there, the token and values never show, and a recording becomes recipes/<site>.md in the agent's memory with its backend calls as call notes.
import test from "node:test";
import assert from "node:assert/strict";
import { AGENT_CAPABILITIES, AgentRefusal, createAgentSession, itemsOfAgent } from "../src/computer/identity.js";
import { callNotes, callTemplate, paramsOf, recipeName, recipeNote, saveRecipe } from "../src/computer/recipes.js";
import { createComputerExtension } from "../src/computer/index.js";
import type { Recording } from "../src/computer/recipes.js";

const AGENT = "agt_intake";
const TOKEN = "agent-token-SENTINEL-0123456789";
const SPACE = "spc_northwind";
const FOLDER = "fld_recipes1";
const PASSWORD = "Tr0ub4dor&3-sentinel";
const TYPED = "typed-sentinel-value";

type Call = { capability: string; input: Record<string, any>; auth: { token: string; as: { kind: string; id: string }; space: string } };

function fakeLink(answers: Record<string, (input: Record<string, any>) => any>) {
  const calls: Call[] = [];
  return {
    calls,
    link: {
      async invoke(capability: string, input: Record<string, any>, auth: Call["auth"]) {
        calls.push({ capability, input, auth });
        const f = answers[capability];
        if (!f) throw new Error(`unexpected ${capability}`);
        return f(input);
      },
    },
  };
}

const item = (id: string, over: Record<string, unknown> = {}) => ({ item: { id, name: id, kind: "login", handle: `#${id}`, fieldKeys: ["username", "password"], owner: "usr_dana", scope: "mine", yourLevel: "manage", ...over }, usernameField: "username" });

const MATCHES = [
  item("vit_own", { owner: AGENT }),
  item("vit_shared_use", { scope: "shared", yourLevel: "use" }),
  item("vit_shared_edit", { scope: "shared", yourLevel: "edit" }),
  item("vit_shared_view", { scope: "shared", yourLevel: "view" }),
  item("vit_dana_mine"),
];

function session(answers: Record<string, (input: Record<string, any>) => any>) {
  const f = fakeLink(answers);
  return { ...f, s: createAgentSession({ agentId: AGENT, spaceId: SPACE, token: TOKEN, recipesFolderId: FOLDER, link: f.link }) };
}

// ---------- identity: the agent token sees only the agent's items ----------

test("itemsOfAgent keeps the agent's own items and those shared with it at Use level or above, and counts the rest", () => {
  const { kept, hidden } = itemsOfAgent(AGENT, MATCHES);
  assert.deepEqual(kept.map((e) => e.item.id), ["vit_own", "vit_shared_use", "vit_shared_edit"]);
  assert.equal(hidden, 2);
  assert.deepEqual(itemsOfAgent(AGENT, null), { kept: [], hidden: 0 });
  assert.deepEqual(itemsOfAgent(AGENT, [{ nothing: true }, null, "x"]), { kept: [], hidden: 3 });
});

test("vault.items.match as the agent: the call carries the agent token, the agent as actor and its one Space; other people's items never come back", async () => {
  const { s, calls } = session({ "vault.items.match": () => ({ items: MATCHES }) });
  const out = await s.invoke("vault.items.match", { url: "https://acme.test" });
  assert.deepEqual(out.items.map((e: any) => e.item.id), ["vit_own", "vit_shared_use", "vit_shared_edit"]);
  assert.equal(out.hidden, 2);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]!.auth, { token: TOKEN, as: { kind: "agent", id: AGENT }, space: SPACE });
  assert.deepEqual(calls[0]!.input, { url: "https://acme.test" });
});

test("fills go by handle: vault.use and vault.fill pass through untouched and no value is ever in a call or a result", async () => {
  const { s, calls } = session({
    "vault.use": () => ({ handle: "#own", fields: ["username", "password"] }),
    "vault.fill": () => ({ filled: true }),
  });
  const used = await s.invoke("vault.use", { item: "vit_own", purpose: "fill acme.test" });
  const done = await s.invoke("vault.fill", { handle: `${used.handle}.password`, target: { kind: "browser", ref: "w1-abc" } });
  assert.deepEqual(done, { filled: true });
  assert.ok(!JSON.stringify([calls, used, done]).includes(PASSWORD));
  assert.equal(calls.every((c) => c.auth.as.id === AGENT && c.auth.space === SPACE), true);
});

test("a person's operations do not exist in an agent's computer", async () => {
  const { s, calls } = session({});
  for (const cap of ["vault.share", "vault.item.put", "vault.item.update", "vault.site_rules.set", "vault.folders.list", "vault.export_env", "kits.install", "mail.send"]) {
    await assert.rejects(() => s.invoke(cap, {}), (e: any) => e instanceof AgentRefusal && e.code === "not_allowed", cap);
  }
  assert.equal(calls.length, 0, "nothing was sent");
  assert.deepEqual(Object.keys(AGENT_CAPABILITIES).sort(), ["files.create", "files.list", "files.write", "vault.fill", "vault.items.match", "vault.use"]);
});

test("the caller cannot name another Space, another actor or a token", async () => {
  const { s, calls } = session({ "vault.items.match": () => ({ items: [] }) });
  for (const extra of [{ space: "spc_other" }, { spaceId: "spc_other" }, { as: { kind: "person", id: "usr_dana" } }, { actor: "usr_dana" }, { principal: "usr_dana" }, { token: "x" }]) {
    await assert.rejects(() => s.invoke("vault.items.match", { url: "https://acme.test", ...extra }), (e: any) => e instanceof AgentRefusal && e.code === "not_allowed");
  }
  assert.equal(calls.length, 0);
});

test("a session needs an agent id, a Space, a long enough token and a recipes folder; the token is in no description, JSON or error", () => {
  const link = fakeLink({}).link;
  const base = { agentId: AGENT, spaceId: SPACE, token: TOKEN, recipesFolderId: FOLDER, link };
  for (const bad of [{ agentId: "usr_dana" }, { agentId: "" }, { spaceId: "no spaces!" }, { token: "short" }, { token: "" }, { recipesFolderId: "../x" }]) {
    assert.throws(() => createAgentSession({ ...base, ...bad }), (e: any) => e instanceof AgentRefusal && !String(e.message).includes(TOKEN));
  }
  const s = createAgentSession(base);
  assert.deepEqual(s.describe(), { kind: "agent", agentId: AGENT, spaceId: SPACE });
  assert.ok(!JSON.stringify(s).includes(TOKEN));
  assert.ok(!String(Object.keys(s)).includes("token"));
});

// ---------- recipes ----------

const RECORDING: Recording = {
  id: "rec_001",
  site: "acme.test",
  startedAt: 1_760_000_000_000,
  steps: [
    { kind: "navigate", url: `https://acme.test/login?next=/matters&token=${TOKEN}` },
    { kind: "type", role: "textbox", name: "Email" },
    { kind: "type", role: "textbox", name: "Password" },
    { kind: "click", role: "button", name: "Sign in" },
    { kind: "click", role: "link", name: "New matter" },
    { kind: "select", role: "combobox", name: "Practice area" },
    { kind: "key", key: "Enter" },
  ],
  calls: [
    { method: "post", url: "https://acme.test/api/login", status: 200, type: "Fetch", mime: "application/json", body: JSON.stringify({ email: "dana@acme.test", password: PASSWORD }), ms: 80 },
    { method: "GET", url: `https://api.acme.test/v2/matters/48213?expand=client&access_token=${TOKEN}`, status: 200, type: "XHR", ms: 120 },
    { method: "GET", url: "https://api.acme.test/v2/matters/99120?expand=client", status: 200, type: "XHR" },
    { method: "POST", url: "https://api.acme.test/v2/matters", status: 201, type: "Fetch", mime: "application/json", body: JSON.stringify({ title: TYPED, clientId: "cli_1", tags: ["a"], meta: { source: "web", apiKey: "k-sentinel" } }), ms: 200 },
    { method: "POST", url: "https://api.acme.test/v2/form", status: 200, type: "XHR", mime: "application/x-www-form-urlencoded", body: `name=${TYPED}&csrf_token=abc123` },
    { method: "GET", url: "https://analytics.example/collect?id=1", status: 200, type: "XHR" },
    { method: "GET", url: "https://api.acme.test/v2/broken", status: 500, type: "XHR" },
    { method: "GET", url: "https://acme.test/static/app.js", status: 200, type: "Script" },
  ],
};

test("recipeName makes <host>.md and refuses anything that is not a host name", () => {
  assert.equal(recipeName("Acme.Test"), "acme.test.md");
  assert.equal(recipeName("app.acme.test."), "app.acme.test.md");
  for (const bad of ["", "../etc/passwd", "a/b", "a b", "acme..test", "-acme.test"]) assert.throws(() => recipeName(bad), bad);
});

test("callTemplate names the changing parts of an address and drops query values", () => {
  assert.deepEqual(callTemplate("https://api.acme.test/v2/matters/48213/notes/6f1c2d3e-aaaa-bbbb-cccc-0123456789ab?expand=client&x=1&x=2"), { template: "https://api.acme.test/v2/matters/{id}/notes/{id2}", host: "api.acme.test", query: ["expand", "x"] });
  assert.equal(callTemplate("mailto:dana@acme.test"), null);
  assert.equal(callTemplate("not a url"), null);
});

test("paramsOf lists names and types only, marks secret-named parameters and never carries a value", () => {
  const p = paramsOf(JSON.stringify({ title: TYPED, n: 3, tags: [1], meta: { source: "web", apiKey: "k-sentinel" }, password: PASSWORD }), "application/json");
  assert.deepEqual(p.map((x) => `${x.name}:${x.type}:${x.secret}`), ["title:string:false", "n:number:false", "tags:list:false", "meta:object:false", "meta.source:string:false", "meta.apiKey:string:true", "password:string:true"]);
  assert.ok(!JSON.stringify(p).includes(TYPED) && !JSON.stringify(p).includes(PASSWORD));
  assert.deepEqual(paramsOf("name=x&csrf_token=y", "application/x-www-form-urlencoded").map((x) => `${x.name}:${x.secret}`), ["name:false", "csrf_token:true"]);
  assert.deepEqual(paramsOf("{not json", "application/json"), []);
  assert.deepEqual(paramsOf(undefined, undefined), []);
});

test("callNotes keeps the site's working XHR and fetch calls once per method and template, and nothing else", () => {
  const notes = callNotes(RECORDING);
  assert.deepEqual(notes.map((n) => `${n.method} ${n.template}`), [
    "POST https://acme.test/api/login",
    "GET https://api.acme.test/v2/matters/{id}",
    "POST https://api.acme.test/v2/matters",
    "POST https://api.acme.test/v2/form",
  ]);
});

test("recipeNote: recipes/<site>.md with the steps, one call note per backend call, and no value, query value, typed text or token anywhere", () => {
  const note = recipeNote(RECORDING, { now: () => Date.parse("2026-10-25T10:00:00Z") });
  assert.equal(note.path, "recipes/acme.test.md");
  assert.equal(note.calls, 4);
  assert.equal(note.steps, 7);
  const md = note.markdown;
  assert.match(md, /^---\nkind: site-recipe\nsite: acme\.test\nlearned: 2026-10-25\nsource: work\/recordings\/rec_001\n---\n# acme\.test/);
  assert.match(md, /## Steps\n1\. Open https:\/\/acme\.test\/login\n2\. Type into textbox "Email"/);
  assert.match(md, /4\. Click button "Sign in"/);
  assert.match(md, /### GET https:\/\/api\.acme\.test\/v2\/matters\/\{id\}\n- Worked in the recording \(200, 120 ms\)\.\n- Query: access_token, expand\n/);
  assert.match(md, /### POST https:\/\/api\.acme\.test\/v2\/matters\n- Worked in the recording \(201, 200 ms\)\.\n- Parameters:\n  - title \(string\)\n  - clientId \(string\)\n  - tags \(list\)\n  - meta \(object\)\n  - meta\.source \(string\)\n  - meta\.apiKey \(string\): from the Vault by handle/);
  assert.match(md, /  - password \(string\): from the Vault by handle/);
  for (const secret of [PASSWORD, TYPED, TOKEN, "k-sentinel", "abc123", "dana@acme.test", "48213"]) assert.ok(!md.includes(secret), `the note does not hold ${secret}`);
  assert.ok(!md.includes("analytics.example") && !md.includes("v2/broken") && !md.includes("app.js"));
});

test("a recording with no calls still makes a note that says so", () => {
  const md = recipeNote({ id: "rec_002", site: "empty.test", startedAt: 0, steps: [], calls: [] }).markdown;
  assert.match(md, /## Steps\n\(none recorded\)/);
  assert.match(md, /## Backend calls\n\(none seen\)/);
});

test("saveRecipe writes a new note into the agent's recipes folder, and the next recording of the same site writes a new version of the same file", async () => {
  const files: { id: string; name: string }[] = [];
  const f = fakeLink({
    "files.list": (i) => ({ files: i["folder"] === FOLDER ? files : [] }),
    "files.create": (i) => { const file = { id: `fil_${files.length + 1}`, name: i["name"] }; files.push(file); return { file }; },
    "files.write": () => ({ ok: true }),
  });
  const s = createAgentSession({ agentId: AGENT, spaceId: SPACE, token: TOKEN, recipesFolderId: FOLDER, link: f.link });
  const note = recipeNote(RECORDING);

  const first = await saveRecipe(s, note, { recordingId: RECORDING.id });
  assert.deepEqual(first, { path: "recipes/acme.test.md", created: true, fileId: "fil_1" });
  const create = f.calls.find((c) => c.capability === "files.create")!;
  assert.equal(create.input["folderId"], FOLDER);
  assert.equal(create.input["name"], "acme.test.md");
  assert.equal(create.input["content"], note.markdown);
  assert.equal(create.input["mime"], "text/markdown");
  assert.equal(typeof create.input["idempotencyKey"], "string");

  const again = await saveRecipe(s, recipeNote({ ...RECORDING, id: "rec_003" }), { recordingId: "rec_003" });
  assert.deepEqual(again, { path: "recipes/acme.test.md", created: false, fileId: "fil_1" });
  const write = f.calls.find((c) => c.capability === "files.write")!;
  assert.equal(write.input["fileId"], "fil_1");
  assert.match(write.input["reason"], /rec_003/);
  assert.equal(f.calls.filter((c) => c.capability === "files.create").length, 1, "no second file");
  assert.equal(f.calls.every((c) => c.auth.as.kind === "agent" && c.auth.as.id === AGENT && c.auth.space === SPACE && c.auth.token === TOKEN), true, "every call is the agent's");
  assert.ok(!JSON.stringify(f.calls.map((c) => c.input)).includes(TOKEN), "the token is never in an input");
});

// ---------- the whole extension in the agent's computer ----------

test("createComputerExtension: the agent finds its items for a page, then learns a recipe from a recording into its memory", async () => {
  const files: { id: string; name: string }[] = [];
  const f = fakeLink({
    "vault.items.match": () => ({ items: MATCHES }),
    "files.list": () => ({ files }),
    "files.create": (i) => { const file = { id: "fil_9", name: i["name"] }; files.push(file); return { file }; },
  });
  const ext = createComputerExtension({ agentId: AGENT, spaceId: SPACE, token: TOKEN, recipesFolderId: FOLDER, link: f.link, now: () => Date.parse("2026-10-25T10:00:00Z") });
  const mine = await ext.itemsFor("https://acme.test");
  assert.deepEqual(mine.items.map((e: any) => e.item.id), ["vit_own", "vit_shared_use", "vit_shared_edit"]);
  const learned = await ext.learnRecipe(RECORDING);
  assert.deepEqual(learned, { path: "recipes/acme.test.md", created: true, fileId: "fil_9", calls: 4, steps: 7 });
  assert.match(String(f.calls.find((c) => c.capability === "files.create")!.input["content"]), /learned: 2026-10-25/);
});
