// Before a message is sent, not after it fails (owner, 3 Nov): when the person has no AI account that could pay for their next message in this chat, the composer says so in one quiet line with
// the fix beside it. The answer is engine.account.resolve in dry mode (the caller is the asker; nothing is recorded), so it is the same rule a turn follows: their own account, then the Space
// accounts kept for team chats. An owner or admin is also offered the Space AI key, which covers everyone. Any error reads as ready: a check that cannot answer never nags.
export type Call = (cap: string, input: unknown) => Promise<unknown>;

export const NO_AI_LINE = "No AI account for this chat yet.";
export const CONNECT_YOURS = "Connect yours";
export const SET_SPACE_KEY = "set a Space AI key";

export interface AiReady { ready: boolean; admin: boolean }

/** Would the caller's next message to this agent here find an account? `admin`: they may set the Space AI key (asked only when not ready). */
export async function aiReady(call: Call, threadId: string, agentId: string): Promise<AiReady> {
  try {
    const r = (await call("engine.account.resolve", { threadId, agentId, dry: true })) as { allowed?: boolean; why?: string };
    if (r.allowed !== false) return { ready: true, admin: false };
    // Company accounts only, with none set: the person cannot fix it by connecting their own
    const admin = await (call("providers.space_key.get", {}) as Promise<{ mayManage?: boolean }>).then((k) => k.mayManage === true, () => false);
    return { ready: false, admin };
  } catch {
    return { ready: true, admin: false };
  }
}
