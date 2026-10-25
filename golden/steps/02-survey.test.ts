// THROWAWAY survey (removed before submit): what does a boot with the L7 modules live say? Fails on purpose so CI prints the transcript.
import test from "node:test";
import { bootFlowSpace } from "./02-space.ts";

const SET = ["identity", "members", "devices", "access", "spaces", "governance", "backup", "audit", "home", "tasks", "files", "chat", "projects"];

test("survey: boot with the access-group modules live", async () => {
  const out: string[] = [];
  const say = (s: string) => out.push(s);
  try {
    const s = await bootFlowSpace(SET);
    say("BOOT OK");
    const owner = s.signedIn("usr_olivia");
    const j = (x: unknown) => JSON.stringify(x).slice(0, 400);
    const mk = await s.call("members.invites.create", owner, { role: "member", groups: ["grp_staff"] });
    say(`invites.create ${mk.status} ${j(mk.body)}`);
    const wi = await s.call("identity.whoami", owner);
    say(`whoami ${wi.status} ${j(wi.body)}`);
    const rp = await s.call("members.remove_preview", owner, { personId: "usr_tess" });
    say(`remove_preview ${rp.status} ${j(rp.body)}`);
    const bc = await s.call("backup.config_get", owner);
    say(`backup.config_get ${bc.status} ${j(bc.body)}`);
    const gv = await s.call("governance.erase.list", owner);
    say(`governance.erase.list ${gv.status} ${j(gv.body)}`);
    const va = await s.call("access.view_as", owner, { principal: { kind: "person", id: "usr_noah" } });
    say(`view_as ${va.status} ${j(va.body)}`);
    say(`events ${j((await s.events(false)).slice(-12))}`);
    await s.stop();
  } catch (e) { say(`BOOT REFUSED ${(e as Error).message}`); }
  throw new Error(`SURVEY\n${out.join("\n")}`);
});
