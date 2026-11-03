// The Vault matrix (test/support/vault-matrix.ts), the "what they have" axis: a person with a Personal Space, or with two Team Spaces on two servers. One account everywhere (the same person, the
// same key bundle): an item saved in one Space never shows in another, and cannot be used there by name. Both directions: the Team Space's items stay out of the second server and out of the
// Personal Space, and the Personal Space's Mine stays out of the Team Spaces. One Space runs at a time (each daemon's modules hold process-wide state, as on a real computer, one per process).
import test from "node:test";
import assert from "node:assert/strict";
import { SCOPE, WHO, api, bootSpace, canUse, fakeProvider, joinAs, passwordSignIn, personalRig, save, seededPerson, signInFrom, teamRig } from "./support/vault-matrix.ts";
import type { Person, Rig, Who } from "./support/vault-matrix.ts";

interface Kept { who: Who; scope: string; name: string; handles: string[] }

test("Vault matrix, what they have: nothing saved in one Space shows in, or is usable from, their Personal Space or their second Team Space", { timeout: 120_000 }, async () => {
  const failures: string[] = [];
  const rows: string[] = ["| who | scope | second Team Space | Personal Space |", "|---|---|---|---|"];
  // 1. their Personal Space: a Mine item of the owner's
  const home = await personalRig({ froms: ["desktop"] });
  let homeItem: { name: string; handles: string[] };
  try {
    const s = await save(home, { token: home.people.owner!.tokens.desktop! }, "home-mine", "mine", {});
    assert.ok(s.saved, JSON.stringify(s.o));
    homeItem = { name: "Key home-mine", handles: [s.saved.handle, s.saved.ai.handle] };
  } finally { await home.stop(); }
  // 2. the Team Space: everyone saves in every scope they may; the owner's Personal Mine is not here
  const kept: Kept[] = [];
  const people: Partial<Record<Who, Person>> = {};
  const team = await teamRig({ froms: ["desktop"] });
  try {
    for (const who of WHO) people[who] = team.people[who]!;
    const homeHere = await canUse(team, team.people.owner!.tokens.desktop!, homeItem.handles[0]!) || await canUse(team, team.people.owner!.tokens.desktop!, homeItem.handles[1]!);
    rows.push(`| owner | Personal Space Mine, in the Team Space | ${homeHere ? "RED (usable there)" : "green"} | (home) |`);
    if (homeHere) failures.push("the Personal Space's Mine is usable from the Team Space");
    for (const who of WHO) for (const scope of SCOPE) {
      if (who === "guest" && scope === "mine") continue;   // a guest keeps nothing in the Vault (the matrix's plain no)
      if (scope === "space_ai_key" && who !== "owner" && who !== "admin") continue;   // set by an owner or admin only
      // a guest keeps nothing; what is shared with them is the owner's
      const s = await save(team, { token: team.people[who === "guest" ? "owner" : who]!.tokens.desktop! }, `has-${who}-${scope}`, scope, { group: team.group!, everyone: team.everyone! });
      if (!s.saved) { failures.push(`${who} ${scope}: could not save (${s.o.line ?? ""})`); continue; }
      kept.push({ who, scope, name: `Key has-${who}-${scope}`, handles: [s.saved.handle, s.saved.ai.handle] });
    }
  } finally { await team.stop(); }
  // 3. their second Team Space on another server: the same people (one account: the same ids and key bundles; invited people join by invite)
  const p2 = fakeProvider();
  const second = await bootSpace("team", p2);
  const t2 = { kind: "team", d: second.d, dir: second.dir, p: p2, people: {} } as unknown as Rig;
  const seen = new Map<string, boolean>();
  try {
    const there = new Map<Who, string>();
    for (const who of WHO) {
      const p = people[who]!;
      if (who === "member_sso" || who === "guest") { there.set(who, await passwordSignIn(second.d, await joinAs(second.d, second.d.token, p.username, who === "guest" ? "Guest" : "Member", undefined, false), "desktop")); continue; }
      const twin = await seededPerson(second.d, p.id);
      twin.personKey = p.personKey;
      there.set(who, await signInFrom(second.d, twin, "desktop"));
    }
    for (const k of kept) {
      const token = there.get(k.who)!;
      const listed = ((await api(second.d, token, "vault.items.list", {})).data.items as Array<{ name: string; handle: string }> ?? []).some((i) => i.name === k.name || k.handles.includes(i.handle));
      seen.set(`${k.who}/${k.scope}`, listed || await canUse(t2, token, k.handles[0]!) || await canUse(t2, token, k.handles[1]!));
    }
    const homeThere = await canUse(t2, there.get("owner")!, homeItem.handles[0]!);
    rows.push(`| owner | Personal Space Mine, in the second Team Space | ${homeThere ? "RED (usable there)" : "green"} | (home) |`);
    if (homeThere) failures.push("the Personal Space's Mine is usable from the second Team Space");
  } finally { await second.d.stop(); }
  // 4. back in their Personal Space: none of the owner's Team Space items
  const home2 = await personalRig({ froms: ["desktop"] });
  try {
    for (const k of kept) {
      const inSecond = seen.get(`${k.who}/${k.scope}`) === true;
      let inHome = false;
      if (k.who === "owner") {
        const token = home2.people.owner!.tokens.desktop!;
        inHome = ((await api(home2.d, token, "vault.items.list", {})).data.items as Array<{ name: string }> ?? []).some((i) => i.name === k.name) || await canUse(home2, token, k.handles[0]!);
      }
      rows.push(`| ${k.who} | ${k.scope} | ${inSecond ? "RED (shows there)" : "green"} | ${k.who !== "owner" ? "n/a" : inHome ? "RED (shows there)" : "green"} |`);
      if (inSecond) failures.push(`${k.who} ${k.scope}: shows in or is usable from their second Team Space`);
      if (inHome) failures.push(`${k.who} ${k.scope}: shows in or is usable from their Personal Space`);
    }
  } finally {
    await home2.stop();
    process.stdout.write(`${rows.join("\n")}\n`);
  }
  assert.equal(failures.length, 0, failures.join("\n"));
});
