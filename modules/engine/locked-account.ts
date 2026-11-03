// A member's own account on a Space server (owner ruling 3 Nov, R62 amended): the server opens the person's Mine items only while it holds their key, which their signed-in session handed over. When it
// does not (they signed out, their sessions ended, the server restarted and nobody has signed in since), their own sign-in cannot pay for the turn, so the next account in their order answers, the Space AI
// key as a rule, and the chat says so in one line. Waiting for a key that only a sign-in brings back would leave the chat silent. Without anything else that can pay, the pick stays and the turn meets the
// locked Vault as before. On a person's own computer (no `held`) nothing changes: the app hands the key over at launch and the turn waits for it.
import type { AccountQuery, ResolvedAccount } from "../../agent/src/turn-engine/types.ts";
import { BRIDGE_PREFIX } from "./handlers/bridge.ts";
import type { PostAs } from "./handlers/bridge.ts";
import { mintId } from "./projections.ts";

export interface LockedDeps {
  resolve(q: AccountQuery): Promise<ResolvedAccount | null>;
  /** Does this server hold the person's key now. Absent: not a Space server, nothing is skipped. */
  held?: (person: string) => boolean;
  postAs?: PostAs;
  log?: (msg: string, attrs?: Record<string, unknown>) => void;
}

/** The chat's line when the Space AI key (or another shared account) answered for a person whose own account is closed. */
export const LOCKED_SPACE_KEY_LINE = "Your own AI account opens when you sign in to this Space, so the Space AI key answered.";
export const lockedLine = (to: ResolvedAccount): string => (to.spaceKey === true ? LOCKED_SPACE_KEY_LINE : "Your own AI account opens when you sign in to this Space, so another account answered.");

const ENGINE = { claude_code: "Claude Code", codex: "Codex", grok: "Grok" } as const;
/** The line when the person's own sign-in is the only way to run the picked model and the server does not hold it. */
export const lockedWords = (a: Pick<ResolvedAccount, "driver">): string => `Your ${(ENGINE as Record<string, string>)[a.driver] ?? "AI"} sign-in is locked on this server. Unlock Vyre on your device, or pick another model.`;

export function skipLocked(d: LockedDeps): (q: AccountQuery) => Promise<ResolvedAccount | null> {
  const held = d.held;
  if (!held) return d.resolve;
  const said = new Set<string>();
  return async (q) => {
    const first = await d.resolve(q);
    // a key of the Space is not the person's own: it never needs their key
    if (!first || first.shared === true) return first;
    // open again: the next time it closes, the chat says so again
    if (held(first.payer)) { for (const k of [...said]) if (k.startsWith(`${q.threadId}|${q.agentId}|`)) said.delete(k); return first; }
    const skipped = [first.ref];
    for (let i = 0; i < 8; i++) {
      // the picked model needs this sign-in and nothing else serves it: never another model under its name, one plain line instead
      const next = await d.resolve({ ...q, unavailable: [...(q.unavailable ?? []), ...skipped] }).catch((e: unknown) => {
        if ((e as { code?: unknown } | null)?.code === "engine.model_unavailable") throw Object.assign(new Error(lockedWords(first)), { code: "engine.model_unavailable" });
        throw e;
      });
      if (!next) break;
      if (next.shared !== true && !held(next.payer)) { skipped.push(next.ref); continue; }
      const key = `${q.threadId}|${q.agentId}|${first.ref}|${next.ref}`;
      if (d.postAs && !said.has(key)) {
        said.add(key);
        try {
          await d.postAs(q.agentId, { actingFor: q.askerId, threadId: q.threadId, body: "", mentions: [], clientId: BRIDGE_PREFIX + mintId("b").slice(2), blocks: [{ type: "turn_status", v: 1, data: { state: "note", text: lockedLine(next) } }] });
        } catch (e) { d.log?.("the account change could not be shown in the chat", { threadId: q.threadId, error: e instanceof Error ? e.message : String(e) }); }
      }
      d.log?.("the person's own account is closed on this server; another answered", { threadId: q.threadId, payer: first.payer, from: first.ref, to: next.ref });
      // not marked as a fallback (the resolver marks it, because the closed account was passed over this turn): the Space AI key covers a member with nothing to approve, as it does for a member
      // with no account at all (switch-on-limit asks only for a paid key nobody chose), and the line above says what happened
      const { fellBack: _passedOver, ...answer } = next;
      return answer;
    }
    return first;
  };
}
