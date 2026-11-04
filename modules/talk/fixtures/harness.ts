// Test harness for Talk: the module's two tables in memory (the four statements the handlers use; anything else throws), a Vault that answers as the real one does for the calls the module makes,
// and a fake host seam that records what it was asked. Cross-layer proof with the real Vault and real access is test/talk.team.live.test.ts.
import type { TalkCtx, TalkDb, TalkHost } from "../projections.ts";
import { setTalkHost } from "../projections.ts";

export const NOW = 1_760_000_000_000;
export const KEY = "dg_test_key_not_a_real_key"; // secret-scan: fake

type Row = Record<string, string | number | null>;
const insert = /^INSERT OR REPLACE INTO (\w+) \(([^)]+)\) VALUES/;
function memory(): TalkDb & { rows: Map<string, Map<string, Row>> } {
  const rows = new Map<string, Map<string, Row>>([["talk_prefs", new Map()], ["talk_space", new Map()]]);
  return {
    rows,
    all(sql, ...a) {
      const m = /^SELECT \* FROM (\w+)(?: WHERE "\w+" = \?)?$/.exec(sql);
      if (!m) throw new Error(`unsupported sql: ${sql}`);
      const t = rows.get(m[1]!)!;
      return sql.includes("WHERE") ? (t.has(String(a[0])) ? [t.get(String(a[0]))] : []) : [...t.values()];
    },
    run(sql, ...a) {
      const del = /^DELETE FROM (\w+) WHERE "\w+" = \?$/.exec(sql);
      if (del) return { changes: rows.get(del[1]!)!.delete(String(a[0])) ? 1 : 0 };
      const m = insert.exec(sql);
      if (!m) throw new Error(`unsupported sql: ${sql}`);
      const cols = m[2]!.split(",").map((c) => c.trim().replace(/"/g, ""));
      rows.get(m[1]!)!.set(String(a[0]), Object.fromEntries(cols.map((c, i) => [c, a[i] as string | number | null])));
      return { changes: 1 };
    },
  };
}

export interface Item { id: string; name: string; handle: string; scope: "mine" | "shared"; owner: string; label?: string; value: string }
export function world(perms: { admins?: readonly string[] } = {}) {
  const db = memory();
  const items: Item[] = [];
  const calls: { cap: string; input: unknown; by: string }[] = [];
  const events: { name: string; payload: unknown }[] = [];
  const logs: string[] = [];
  const minted: { handle: string; asker?: string; own: boolean }[] = [];
  const checked: string[] = [];
  const answers = { check: null as Error | null, mint: null as Error | null };
  let n = 0;
  const host: TalkHost = {
    async check(_c, p) { checked.push(p.apiKey); if (answers.check) throw answers.check; },
    async mint(_c, p) { minted.push(p); if (answers.mint) throw answers.mint; return { token: "jwt.short.lived", expiresIn: 30 }; },
  };
  setTalkHost(host);
  const as = (principal: TalkCtx["principal"], o: { actingFor?: string; thread?: string } = {}): TalkCtx => ({
    space: "spc_test", principal, actingFor: o.actingFor, thread: o.thread, trace: { traceId: "0".repeat(32) }, now: () => NOW, db,
    emit: (name, _s, payload) => { events.push({ name, payload }); return null; },
    log: { info: (m) => logs.push(m), warn: (m) => logs.push(m) },
    authorize: (action) => ({ effect: action.perm === "policy.manage" && !(perms.admins ?? []).includes(principal.id) ? "deny" : "allow" }),
    async call(cap, input) {
      calls.push({ cap, input, by: principal.id });
      const i = input as Record<string, unknown>;
      if (cap === "vault.items.list") return { items: items.filter((it) => (it.scope === "mine" ? it.owner === principal.id : false)) };
      if (cap === "vault.folders.list") return { folders: [] };
      if (cap === "vault.folders.create") return { folder: { id: `vfd_${++n}` } };
      if (cap === "vault.item.put") {
        const field = (i["fields"] as { value: string }[])[0]!;
        const item: Item = { id: `vit_${++n}`, name: String(i["name"]), handle: `#${String(i["name"]).replace(/\W+/g, "_")}`, scope: String(i["folderId"]).startsWith("vfd") && i["spaceOnly"] ? "shared" : "mine", owner: principal.id, value: field.value };
        items.push(item);
        return { item };
      }
      if (cap === "vault.item.update") { items.find((it) => it.id === i["itemId"])!.value = (i["fieldsSet"] as { value: string }[])[0]!.value; return { item: {} }; }
      if (cap === "vault.item.delete") { items.splice(items.findIndex((it) => it.id === i["itemId"]), 1); return { ok: true }; }
      if (cap === "vault.use") return { handle: items.find((it) => it.id === i["item"])!.handle };
      if (cap === "access.labels.set") { const it = items.find((x) => x.id === (i["resource"] as { id: string }).id); if (it) it.label = String(i["label"]); return {}; }
      if (cap === "chat.post") return { ok: true };
      throw new Error(`unexpected call ${cap}`);
    },
  });
  return { db, items, calls, events, logs, minted, checked, answers, as };
}
export const person = (id: string): TalkCtx["principal"] => ({ kind: "person", id });
export const agent = (id: string): TalkCtx["principal"] => ({ kind: "agent", id });
