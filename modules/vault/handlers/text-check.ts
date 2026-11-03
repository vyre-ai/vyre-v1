// vault.text_check (lane l-agentdm): before an agent's words go to a teammate, which of the person's own Mine items have a value in them. It answers handles only, never a value, and only for the
// person behind the call (the person an agent acts for). A Mine item opens only with the person's own key, so when that key is not held on this computer the answer says it could not check.
import { ENC_MINE, currentKeyPort, openMine, wrapKeyFromPersonKey } from "./crypto.ts";
import { leaks } from "./use.ts";
import { ensure, num, parseJson, rowsOf, str } from "../projections.ts";
import type { VaultCtx } from "../projections.ts";

export async function textCheck(ctx: VaultCtx, input: { text: string }): Promise<{ handles: string[]; checked: boolean }> {
  ensure(ctx);
  const person = ctx.actingFor?.startsWith("usr_") ? ctx.actingFor : ctx.principal.kind === "person" ? ctx.principal.id : undefined;
  if (!person || input.text.trim() === "") return { handles: [], checked: true };
  const mine = rowsOf(ctx.db.all(`SELECT * FROM vault_meta`)).filter((r) => r["deleted_at"] == null && str(r, "scope") === "mine" && str(r, "owner") === person);
  if (mine.length === 0) return { handles: [], checked: true };
  const key = await currentKeyPort()?.personKey(person);
  if (!key) return { handles: [], checked: false };
  const wrap = wrapKeyFromPersonKey(key);
  const secrets: { handle: string; value: string }[] = [];
  for (const meta of mine) {
    const row = rowsOf(ctx.db.all(`SELECT * FROM vault_secret WHERE "itemId" = ?`, str(meta, "id")))[0];
    if (!row) continue;
    try {
      const fields = openMine(str(meta, "id"), { enc: ENC_MINE, keyId: str(row, "keyId"), box: parseJson(row["box"], { iv: "", ct: "", tag: "" }), rev: num(row, "rev"), wrapped: parseJson(row["wrapped"], { iv: "", ct: "", tag: "" }) }, wrap);
      for (const f of fields) if (f.secret !== false && f.value) secrets.push({ handle: str(meta, "handle") || str(meta, "name"), value: f.value });
    } catch { /* a row this key does not open is not the person's to check */ }
  }
  return { handles: [...new Set(leaks(input.text, secrets))], checked: true };
}
