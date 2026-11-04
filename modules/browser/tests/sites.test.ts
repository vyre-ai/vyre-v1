// Browser connections through the real handlers (manifests/browser.ts): a person adds a site, says where it runs and which agents Read only or Act, changes it, removes it; their rows are their own;
// an agent lists only the sites that name it and cannot set or widen a right. The in-memory db reads the module's migration and refuses a table the host's module guard would refuse.
// @reads /generated/registry.json
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validate } from "../../../packages/contracts/src/jsonschema.ts";
import type { JsonSchema } from "../../../packages/contracts/src/types.ts";
import { handlers } from "../impl.ts";
import { columns, MIGRATION } from "../fixtures/db.ts";
import { world } from "../fixtures/world.ts";
import { hostOf } from "../projections.ts";

interface RegCap { name: string; input: JsonSchema; output: JsonSchema }
const registry = JSON.parse(readFileSync(new URL("../../../generated/registry.json", import.meta.url), "utf8")) as { $defs: Record<string, JsonSchema>; capabilities: RegCap[] };
const outputOk = (cap: string, out: unknown): void => {
  const c = registry.capabilities.find((x) => x.name === cap)!;
  assert.deepEqual(validate(c.output, out, "", registry.$defs), [], `${cap} output`);
};
const codeOf = (e: unknown): string | undefined => (e && typeof e === "object" && "error" in e ? (e as { error?: { code?: string } }).error?.code : undefined);
const failed = (p: Promise<unknown>): Promise<string | undefined> => p.then(() => undefined, (e: unknown) => codeOf(e) ?? String(e));
let n = 0;
const key = (): string => `k_${++n}`;

test("every capability has a real handler and the table is the module's own", () => {
  for (const k of ["browser.sites.list", "browser.sites.set", "browser.sites.remove"]) assert.equal(typeof (handlers as Record<string, unknown>)[k], "function", k);
  assert.deepEqual([...columns(readFileSync(MIGRATION, "utf8")).keys()], ["browser_sites"]);
});

test("a site is named by its host: an address, a path or capitals all mean the same site, and what is not a site is refused", () => {
  assert.equal(hostOf("https://App.GoHighLevel.com/contacts?x=1"), "app.gohighlevel.com");
  assert.equal(hostOf("app.gohighlevel.com:8443/x"), "app.gohighlevel.com");
  assert.equal(hostOf("localhost"), "localhost");
  for (const bad of ["", "  ", "*.example.com", "example", "a b.com", "..com", "http://"]) assert.equal(hostOf(bad), null, JSON.stringify(bad));
});

test("a person adds a site, then changing it keeps one row; rights are Read only or Act per agent", async () => {
  const w = world();
  const a = await handlers["browser.sites.set"](w.as("usr_olivia"), { host: "https://app.gohighlevel.com/x", runsIn: "chrome", rights: [{ agentId: "agt_scout", right: "read" }], idempotencyKey: key() });
  outputOk("browser.sites.set", a);
  assert.equal(a.site.host, "app.gohighlevel.com");
  assert.deepEqual(a.site.rights, [{ agentId: "agt_scout", right: "read" }]);
  const b = await handlers["browser.sites.set"](w.as("usr_olivia"), { host: "app.gohighlevel.com", runsIn: "both", rights: [{ agentId: "agt_scout", right: "act" }, { agentId: "agt_intake", right: "read" }], idempotencyKey: key() });
  assert.equal(b.site.id, a.site.id, "one row per person and site");
  assert.equal(b.site.runsIn, "both");
  const list = await handlers["browser.sites.list"](w.as("usr_olivia"));
  outputOk("browser.sites.list", list);
  assert.equal(list.sites.length, 1);
  assert.deepEqual(list.sites[0]!.rights.map((r) => [r.agentId, r.right]), [["agt_scout", "act"], ["agt_intake", "read"]]);
  assert.deepEqual(w.events.map((e) => e.name), ["browser.site_changed", "browser.site_changed"]);
});

test("rows are a person's own, and an agent sees only the sites that name it, with only its own right", async () => {
  const w = world();
  await handlers["browser.sites.set"](w.as("usr_olivia"), { host: "a.example.com", runsIn: "chrome", rights: [{ agentId: "agt_scout", right: "act" }, { agentId: "agt_intake", right: "read" }], idempotencyKey: key() });
  await handlers["browser.sites.set"](w.as("usr_olivia"), { host: "b.example.com", runsIn: "computers", rights: [{ agentId: "agt_intake", right: "act" }], idempotencyKey: key() });
  await handlers["browser.sites.set"](w.as("usr_noah"), { host: "a.example.com", runsIn: "both", rights: [], idempotencyKey: key() });
  assert.deepEqual((await handlers["browser.sites.list"](w.as("usr_noah"))).sites.map((s) => s.host), ["a.example.com"]);
  assert.deepEqual((await handlers["browser.sites.list"](w.as("usr_olivia"))).sites.map((s) => s.host), ["a.example.com", "b.example.com"]);
  const scout = (await handlers["browser.sites.list"](w.as("agt_scout", "agent", "usr_olivia"))).sites;
  assert.deepEqual(scout.map((s) => [s.host, s.rights]), [["a.example.com", [{ agentId: "agt_scout", right: "act" }]], ["b.example.com", []]], "acting for Olivia it sees her sites, with only its own right");
  const outsider = (await handlers["browser.sites.list"](w.as("agt_other", "agent"))).sites;
  assert.deepEqual(outsider, [], "an agent no row names sees nothing");
});

test("an agent cannot set or remove a Browser connection, and a bad host, runs-in or right is refused", async () => {
  const w = world();
  assert.equal(await failed(handlers["browser.sites.set"](w.as("agt_scout", "agent", "usr_olivia"), { host: "a.example.com", runsIn: "chrome", rights: [{ agentId: "agt_scout", right: "act" }], idempotencyKey: key() })), "permission.no_grant");
  assert.equal(await failed(handlers["browser.sites.set"](w.as("usr_olivia"), { host: "no site", runsIn: "chrome", rights: [], idempotencyKey: key() })), "validation.bad_input");
  assert.equal(await failed(handlers["browser.sites.set"](w.as("usr_olivia"), { host: "a.example.com", runsIn: "cloud" as never, rights: [], idempotencyKey: key() })), "validation.bad_input");
  assert.equal(await failed(handlers["browser.sites.set"](w.as("usr_olivia"), { host: "a.example.com", runsIn: "chrome", rights: [{ agentId: "agt_scout", right: "admin" as never }], idempotencyKey: key() })), "validation.bad_input");
  const made = await handlers["browser.sites.set"](w.as("usr_olivia"), { host: "a.example.com", runsIn: "chrome", rights: [], idempotencyKey: key() });
  assert.equal(await failed(handlers["browser.sites.remove"](w.as("agt_scout", "agent", "usr_olivia"), { siteId: made.site.id })), "validation.not_found");
  assert.equal(await failed(handlers["browser.sites.remove"](w.as("usr_noah"), { siteId: made.site.id })), "validation.not_found", "somebody else's row is not found");
});

test("remove takes the site out of the list, and adding it again makes a fresh row", async () => {
  const w = world();
  const a = await handlers["browser.sites.set"](w.as("usr_olivia"), { host: "a.example.com", runsIn: "chrome", rights: [], idempotencyKey: key() });
  outputOk("browser.sites.remove", await handlers["browser.sites.remove"](w.as("usr_olivia"), { siteId: a.site.id }));
  assert.deepEqual((await handlers["browser.sites.list"](w.as("usr_olivia"))).sites, []);
  const b = await handlers["browser.sites.set"](w.as("usr_olivia"), { host: "a.example.com", runsIn: "both", rights: [], idempotencyKey: key() });
  assert.notEqual(b.site.id, a.site.id);
  assert.equal(w.events.at(-2)!.name, "browser.site_changed");
  assert.deepEqual((w.events.at(-2)!.payload as { removed: boolean }).removed, true);
});
