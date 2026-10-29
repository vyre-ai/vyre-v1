// The host half of sign-in for the module's own tests: devices.register as a capability call, and the session-token seam the host supplies (mint a token for a devices session, end it at the gateway).
// `harness` here is the fixture harness with both wired, so a test signs in the way the host does. The session ends it records are in `ended`.
import { configureSessionTokens } from "../projections.ts";
import type { IdentityCtx } from "../projections.ts";
import { harness as fixture } from "../fixtures/db.ts";
import {createRecoveryCommit} from "../../../host/src/seams/recovery.ts";

export { codeOf, DEVICE, KEYS, NOW } from "../fixtures/db.ts";

let seq = 0;
export function harness(now?: number) {
  const h = fixture(now);
  h.raw.addSchema("CREATE TABLE IF NOT EXISTS devices_session (id TEXT PRIMARY KEY, person TEXT NOT NULL, kind TEXT NOT NULL, revoked_at INTEGER)");
  const registered: { person: string; name: string; class: string }[] = [];
  const ended: string[] = [];
  const call = async (name: string, input: unknown): Promise<unknown> => {
    if (name !== "devices.register") throw new Error(`unexpected capability ${name}`);
    const i = input as { person: string; name: string; class: string };
    registered.push(i);
    seq += 1;
    h.raw.run("INSERT INTO devices_session (id, person, kind, revoked_at) VALUES (?, ?, ?, ?)",`ses_w${seq}`,i.person,"device",null);
    return { device: { id: `dev_w${seq}` }, sessionId: `ses_w${seq}` };
  };
  configureSessionTokens({
    mint: (sessionId) => `vst_${sessionId.replace(/[^a-z0-9]/g, "")}${"0".repeat(48)}`,
    end: (sessionId) => { ended.push(sessionId); },
  });
  const recoveryCommit=createRecoveryCommit({db:h.raw,now:h.anon.now});
  const withCall = (c: IdentityCtx): IdentityCtx => ({ ...c, call,recoveryCommit });
  return { ...h, anon: withCall(h.anon), as: (id: string, session?: { id: string; deviceId: string }) => withCall(h.as(id, session)), registered, ended };
}
