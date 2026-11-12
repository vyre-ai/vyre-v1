// An agent computer's own Vault calls go through the team-agent rule (lead 12 Nov). The old desktop's extension asks the fill channel which items fit a page (vault.items.match) and for a handle to
// one (vault.use); those calls went straight to the Vault, around host/src/seams/team-vault.ts, which held only handle lookups. On a booted daemon with the real Vault, access engine and fill
// channel (the token a turn takes, as host/src/seams/computers.ts issues it): Olivia's turn through Noah's team agent's computer gets neither her own Mine item nor Noah's, and a Shared item only
// when it is shared with the agent; her own Assistant's computer is not narrowed.
import test from "node:test";
import assert from "node:assert/strict";
import { boot, call, connect, newAgent, seededDir } from "./memory-live-kit.ts";
import { boundFill } from "../modules/computers/projections.ts";
import { FILL_PATH } from "../host/src/seams/computers.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

const PEOPLE = ["usr_olivia", "usr_adam", "usr_mia", "usr_noah", "usr_sana", "usr_tess"];
let n = 0;
async function ok(d: Daemon, cap: string, input: Record<string, unknown>): Promise<any> {
  // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await call(d, cap, { idempotencyKey: `df-${++n}`, ...input });
  assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data)}`);
  return r.data;
}

test("a team agent's computer: its own Vault calls never list or take a person's Mine item, and a Shared item only when shared with the agent; the asker's own Assistant's computer is not narrowed", async () => {
  const session = (h: Record<string, string | undefined>) => {
    const id = String(h["authorization"] ?? "").replace(/^Bearer /, "");
    return {
      space: "spc_core",
      principal: { kind: "person", id: PEOPLE.includes(id) ? id : "usr_olivia" },
      device: "mac",
    };
  };
  const d = await boot(seededDir(), undefined, undefined, { session } as never);
  try {
    await connect(d); // Olivia's key, so her Mine items can be made

    // Noah's team agent, which Tess may also ask; Olivia's Assistant
    const desk = await newAgent(d, "Front Desk");
    await ok(d, "agents.set_owner", { agentId: desk.id, ownerId: "usr_noah" });
    await ok(d, "access.share", {
      resource: { type: "agent", id: desk.id },
      subject: { kind: "person", id: "usr_tess" },
      level: "use",
    });
    const assistant = await newAgent(d, "Olivia Assistant");
    {
      const { DatabaseSync } = await import("node:sqlite");
      const mdb = new DatabaseSync(d.paths.modules);
      mdb.prepare(`UPDATE agents_agent SET "kind" = 'assistant' WHERE "id" = ?`).run(assistant.id);
      mdb.close();
    }

    // the items, each a login for the same site
    const login = (name: string) => ({
      name,
      kind: "login",
      fields: [
        { key: "url", value: "https://bank.example", secret: false },
        { key: "username", value: `${name.toLowerCase().replace(/ /g, "-")}-user`, secret: false },
        { key: "password", value: `pw-${name.length}-0123456789`, secret: true },
      ],
    }); // secret-scan: fake
    const oMine = (await ok(d, "vault.folders.create", { name: "Olivia keys", scope: "mine" })).folder.id as string;
    const oItem = String((await ok(d, "vault.item.put", { folderId: oMine, ...login("Olivia Bank") })).item.id);
    // a Mine item of Noah's: his key is not on this test's computer, so its row is made as his Vault would have it (owner Noah, scope mine); nothing of it is ever opened here
    const nItem = "vit_0123456789abcdef0123456789abcdef";
    {
      const { DatabaseSync } = await import("node:sqlite");
      const mdb = new DatabaseSync(d.paths.modules);
      const cols = (mdb.prepare(`PRAGMA table_info(vault_meta)`).all() as Array<{ name: string }>).map((c) => c.name);
      const q = (c: string): string => `"${c}"`;
      mdb
        .prepare(
          `INSERT INTO vault_meta (${cols.map(q).join(", ")}) SELECT ${cols.map((c) => (c === "id" ? "?" : c === "owner" ? "'usr_noah'" : c === "handle" ? "'#Noah_Bank'" : c === "name" ? "'Noah Bank'" : q(c))).join(", ")} FROM vault_meta WHERE "id" = ?`,
        )
        .run(nItem, oItem);
      mdb.close();
    }
    const team = (await ok(d, "vault.folders.create", { name: "Team keys", scope: "shared" })).folder.id as string;
    const forDesk = String((await ok(d, "vault.item.put", { folderId: team, ...login("Desk Bank") })).item.id);
    const notDesk = String((await ok(d, "vault.item.put", { folderId: team, ...login("Members Bank") })).item.id);
    await ok(d, "vault.share", {
      resource: { type: "vault_item", id: forDesk },
      subject: { kind: "agent", id: desk.id },
      level: "use",
    });

    const fill = boundFill();
    assert.ok(fill, "the daemon binds the agent computers' Vault channel");
    const ask = async (agentId: string, body: Record<string, unknown>): Promise<{ status: number; body: any }> => {
      // eslint-disable-line @typescript-eslint/no-explicit-any
      const grant = await fill!.issue({ computerId: "cmt_desktest", agentId, asker: "usr_olivia", turn: true });
      try {
        const r = await fetch(`${d.url}${FILL_PATH}`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${grant.fillToken}` },
          body: JSON.stringify({ computerId: "cmt_desktest", ...body }),
        });
        return { status: r.status, body: await r.json() };
      } finally {
        grant.revoke();
      }
    };
    const matched = async (agentId: string): Promise<string[]> => {
      const r = await ask(agentId, {
        op: "invoke",
        capability: "vault.items.match",
        input: { url: "https://bank.example/login" },
      });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      return ((r.body.output?.items ?? []) as Array<{ item: { id: string } }>).map((x) => x.item.id).sort();
    };
    const used = async (agentId: string, item: string): Promise<number> =>
      (await ask(agentId, { op: "invoke", capability: "vault.use", input: { item, purpose: "fill" } })).status;
    const handleOf = (id: string): string =>
      String((d.db!.all(`SELECT "handle" FROM vault_meta WHERE "id" = ?`, id)[0] as { handle: string }).handle);

    // Olivia's turn through Noah's team agent's computer
    assert.deepEqual(
      await matched(desk.id),
      [forDesk],
      "only the item shared with the agent is offered; neither Mine item, nor the one Tess may not use",
    );
    assert.equal(await used(desk.id, handleOf(oItem)), 403, "her own Mine item: refused in a team agent's computer");
    assert.notEqual(await used(desk.id, handleOf(nItem)), 200, "Noah's Mine item: never hers to use");
    assert.equal(
      await used(desk.id, handleOf(notDesk)),
      403,
      "a Shared item not shared with the agent, which Tess may not use",
    );
    assert.equal(await used(desk.id, handleOf(forDesk)), 200, "shared with the agent: used");
    // the fill path agrees
    assert.notEqual(
      (await ask(desk.id, { handle: handleOf(oItem).replace(/^#/, ""), field: "password" })).status,
      200,
      "the fill of her Mine item's password is refused too",
    );

    // her own Assistant's computer: the gate does not narrow it (what the Vault itself gives an agent acting for her is its own rule, unchanged here)
    const own = await matched(assistant.id);
    assert.ok(
      own.includes(notDesk) && own.includes(forDesk),
      `every Shared item she may use is offered in her own Assistant's computer: ${JSON.stringify(own)}`,
    );
    assert.equal(await used(assistant.id, handleOf(notDesk)), 200, "and used there");
  } finally {
    await d.stop();
  }
});
