// The Vault matrix (test/support/vault-matrix.ts), the "what they have" axis: a person with a Personal Space, or with two Team Spaces on two servers. One account everywhere (the same person, the
// same key bundle): an item saved in one Space never shows in another, cannot be used there by name, and a turn there cannot run on it. Both directions: the Team Space's items stay out of the
// second server and out of the Personal Space, and the Personal Space's Mine stays out of the Team Spaces.
import test from "node:test";
import assert from "node:assert/strict";
import { SCOPE, WHO, api, bootSpace, canUse, fakeProvider, joinAs, passwordSignIn, personalRig, save, seededPerson, signInFrom, teamRig } from "./support/vault-matrix.ts";
import type { Rig } from "./support/vault-matrix.ts";

test("Vault matrix, what they have: nothing saved in one Space shows in, or is usable from, their Personal Space or their second Team Space", { timeout: 120_000 }, async () => {
  const team = await teamRig({ froms: ["desktop"] });
  const p2 = fakeProvider();
  const second = await bootSpace("team", p2);
  const personal = await personalRig({ froms: ["desktop"] });
  const failures: string[] = [];
  const rows: string[] = ["| who | scope | second Team Space | Personal Space |", "|---|---|---|---|"];
  try {
    const t2 = { kind: "team", d: second.d, dir: second.dir, p: p2, people: {} } as unknown as Rig;
    const there = new Map<string, string>();
    // the same people on the second server (one account everywhere: the same id and key bundle), signed in and their key handed over there
    for (const who of WHO) {
      const p = team.people[who]!;
      if (who === "member_sso" || who === "guest") {
        // people who joined by invite join the second server by invite too
        const joined = await joinAs(second.d, second.d.token, p.username, who === "guest" ? "Guest" : "Member");
        there.set(who, await passwordSignIn(second.d, joined, "desktop"));
        continue;
      }
      const twin = await seededPerson(second.d, p.id);
      twin.personKey = p.personKey;
      there.set(who, await signInFrom(second.d, twin, "desktop"));
    }
    const ownerHome = personal.people.owner!.tokens.desktop!;
    // the owner's own Mine in the Personal Space: it must not show in the Team Spaces either
    const home = await save(personal, { token: ownerHome }, "home-mine", "mine", {});
    assert.ok(home.saved, JSON.stringify(home.o));
    for (const who of WHO) for (const scope of SCOPE) {
      if (who === "guest" && scope === "mine") continue;   // a guest keeps nothing in the Vault (the matrix's plain no)
      if (scope === "space_ai_key" && who !== "owner" && who !== "admin") continue;   // set by an owner or admin only
      // a guest keeps nothing; what is shared with them is the owner's
      const s = await save(team, { token: team.people[who === "guest" ? "owner" : who]!.tokens.desktop! }, `has-${who}-${scope}`, scope, { group: team.group!, everyone: team.everyone! });
      if (!s.saved) { failures.push(`${who} ${scope}: could not save (${s.o.line ?? ""})`); continue; }
      const listed = async (rig: Rig, token: string): Promise<boolean> => ((await api(rig.d, token, "vault.items.list", {})).data.items as Array<{ name: string; handle: string }> ?? []).some((i) => i.handle === s.saved!.handle || i.name === `Key has-${who}-${scope}`);
      const inSecond = await listed(t2, there.get(who)!) || await canUse(t2, there.get(who)!, s.saved.handle) || await canUse(t2, there.get(who)!, s.saved.ai.handle);
      const inHome = who === "owner" && (await listed(personal, ownerHome) || await canUse(personal, ownerHome, s.saved.handle));
      rows.push(`| ${who} | ${scope} | ${inSecond ? "RED (shows there)" : "green"} | ${who !== "owner" ? "n/a" : inHome ? "RED (shows there)" : "green"} |`);
      if (inSecond) failures.push(`${who} ${scope}: shows in or is usable from their second Team Space`);
      if (inHome) failures.push(`${who} ${scope}: shows in or is usable from their Personal Space`);
    }
    const homeInTeam = await canUse(team, team.people.owner!.tokens.desktop!, home.saved!.handle) || await canUse(t2, there.get("owner")!, home.saved!.handle);
    rows.push(`| owner | Personal Space Mine | ${homeInTeam ? "RED (shows there)" : "green"} | (home) |`);
    if (homeInTeam) failures.push("the Personal Space's Mine is usable from a Team Space");
  } finally {
    process.stdout.write(`${rows.join("\n")}\n`);
    await personal.stop();
    await second.d.stop();
    await team.stop();
  }
  assert.equal(failures.length, 0, failures.join("\n"));
});
