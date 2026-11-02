// More people in a booted Space, over HTTP with their own tokens: an invite, an acceptance, and a caller that speaks as them.
import assert from "node:assert/strict";
import type { Daemon } from "../../host/src/daemon/daemon.ts";

const PASSWORD = "correct horse battery staple 9";
const KEYS = { personKeyByPassword: "cGVyc29uLWJ5LXBhc3N3b3Jk", publicKey: "cHVibGljLWtleQ==", privateKeyWrapped: "cHJpdmF0ZS13cmFwcGVk", spaceKeys: [{ epoch: 1, wrapped: "c3BhY2Uta2V5LTE=" }] };
const DEVICE = { deviceName: "Test browser", deviceClass: "desktop" };
export type Out = { status: number; data: any };   // eslint-disable-line @typescript-eslint/no-explicit-any
export interface Person { id: string; token: string }
export type Caller = (cap: string, input?: Record<string, unknown>) => Promise<Out>;

let keys = 0;
export const as = (d: Daemon, token: string): Caller => async (cap, input = {}) => {
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ idempotencyKey: `pp-${cap}-${++keys}`, ...input }) });
  const body = (await r.json()) as { data?: unknown; error?: unknown };
  return { status: r.status, data: body.data ?? body };
};

export async function join(d: Daemon, owner: Caller, role: "Admin" | "Member", username: string, name: string): Promise<Person> {
  const roles = (await owner("access.roles.list")).data.roles as { id: string; name: string }[];
  const invite = await owner("members.invites.create", { role: roles.find((r) => r.name === role)!.id });
  assert.equal(invite.status, 200, JSON.stringify(invite.data));
  const code = decodeURIComponent(new URL(invite.data.link).pathname.split("/").pop() ?? "");
  const r = await fetch(`${d.url}/v1/members/accept`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, username, displayName: name, password: PASSWORD, keys: KEYS, ...DEVICE }) });
  const body = (await r.json()) as { data?: { token: string; personId: string } };
  assert.equal(r.status, 200, JSON.stringify(body));
  return { id: body.data!.personId, token: body.data!.token };
}
