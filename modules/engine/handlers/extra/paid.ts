// Who paid for a turn, in a plain line for the turn's details (owner, 3 Nov, the Chat key ruling): the agent's Chat key when it is on and it paid, a Space AI account, or the person's own account.
// Read from the agent's setting and the account's row at the time the details are opened, so nothing about the turn has to be stored.
type Call = (cap: string, input: unknown) => Promise<unknown>;

export async function paidLine(ctx: object, turn: { agentId: string; keyUsed?: string }): Promise<string | undefined> {
  const key = turn.keyUsed;
  const call = (ctx as { call?: Call }).call;
  if (key === undefined || !call) return undefined;
  let chatKey: string | undefined;
  try {
    const a = (await call("agents.get", { agentId: turn.agentId })) as { agent?: { accountPolicy?: string; accountKey?: string } };
    if (a.agent?.accountPolicy === "key") chatKey = a.agent.accountKey;
  } catch { /* an agent the viewer cannot read: the line says only whose account it was */ }
  let row: { scope?: string; name?: string } | undefined;
  try {
    const out = (await call("providers.list", {})) as { providers?: Array<{ handle?: string; itemId?: string; id?: string; scope?: string; name?: string }> };
    row = out.providers?.find((p) => p.handle === key || p.itemId === key || p.id === key);
  } catch { /* not listed */ }
  const name = row?.name ?? key;
  if (chatKey !== undefined && chatKey === key) return `${name} paid, because this agent's Chat key is on: it pays for chats with this account instead of each person's own.`;
  if (row?.scope === "shared") return `${name} paid: a Space AI account.`;
  return "The asker's own AI account paid.";
}
