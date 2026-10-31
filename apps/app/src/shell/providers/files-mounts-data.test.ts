// The Mounts sheet asks GitHub for installations only when the GitHub App is set up: with none, the call is sure to fail and the sheet just says GitHub is not connected.
import test from "node:test";
import assert from "node:assert/strict";
import { loadAccounts } from "./files-mounts-data.ts";

const calls = (health: unknown): { seen: string[]; call: (cap: string) => Promise<unknown> } => {
  const seen: string[] = [];
  return {
    seen,
    call: async (cap) => {
      seen.push(cap);
      if (cap === "connections.list") return { connections: [] };
      if (cap === "github.health") { if (health instanceof Error) throw health; return health; }
      if (cap === "github.installations.list") return { installations: [{ id: 1, account: "acme" }] };
      throw new Error(`unexpected ${cap}`);
    },
  };
};

test("no GitHub App: installations are not asked for, and GitHub reads as not connected", async () => {
  const c = calls({ state: "healthy", detail: "The GitHub App is not set up yet. Create it in Settings, Integrations." });
  const a = await loadAccounts(c.call, null);
  assert.equal(c.seen.includes("github.installations.list"), false);
  assert.equal(a.github.connected, false);
});

test("a health probe that fails is the same as no App", async () => {
  const c = calls(new Error("down"));
  assert.equal((await loadAccounts(c.call, null)).github.connected, false);
  assert.equal(c.seen.includes("github.installations.list"), false);
});

test("a set-up App: the installation names the account", async () => {
  const c = calls({ state: "healthy", latencyMs: 40 });
  const a = await loadAccounts(c.call, null);
  assert.deepEqual([a.github.connected, a.github.label], [true, "acme"]);
});

test("connect GitHub in place: open the install page, poll until the installation appears, then hand its account back", async () => {
  const { connectGithub } = await import("./files-mounts-data.ts");
  const opened: string[] = [];
  let reads = 0;
  const call = async (cap: string): Promise<unknown> => {
    if (cap === "github.app.get") return { slug: "vyre-acme" };
    reads += 1;
    return { installations: reads >= 4 ? [{ account: "acme" }] : [] };
  };
  const got = await connectGithub(call, (u) => opened.push(u), { sleep: async () => undefined });
  assert.deepEqual(got, { label: "acme", connected: true });
  assert.deepEqual(opened, ["https://github.com/apps/vyre-acme/installations/new"]);
});

test("connect GitHub in place: an installation that already exists opens no page; no App set up says so; giving up returns null", async () => {
  const { connectGithub } = await import("./files-mounts-data.ts");
  const opened: string[] = [];
  const has = async (cap: string): Promise<unknown> => (cap === "github.app.get" ? { slug: "s" } : { installations: [{ account: "acme" }] });
  assert.deepEqual(await connectGithub(has, (u) => opened.push(u), { sleep: async () => undefined }), { label: "acme", connected: true });
  assert.equal(opened.length, 0);
  assert.equal(await connectGithub(async () => { throw new Error("not set up"); }, () => undefined), "not_set_up");
  const none = async (cap: string): Promise<unknown> => (cap === "github.app.get" ? { slug: "s" } : { installations: [] });
  assert.equal(await connectGithub(none, () => undefined, { sleep: async () => undefined, tries: 3 }), null);
});
