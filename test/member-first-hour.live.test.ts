// Release gate: a newly invited member's first hour on a Vyre Server Space, part 1 of 3 (sign-in and the Vault). The owner's team met a stream of small breaks on 3 Nov: the Vault could not hold a
// member's own AI sign-in, "Mine Vault is locked" with no way out, Vault sections that looked dead, the Space id where its name goes. The owner: "When someone is invited, they should just be able
// to login or whatever and vault should work in every circumstance". This walks it on a server-role daemon at its own address with the real identity and Vault (test/support/member-hour.ts):
// the owner invites two people by email, Aina joins by password in Chrome and Bilal with Google in the Windows app, both sign in again later, their Vault is open with no prompt, they add a key
// and a login and see what they were given, their own Claude runs their turns and the Space AI key answers after they sign out, and neither sees the other's items. Part 2 is chats and keys asked
// for in a chat (member-first-hour.chats.live.test.ts), part 3 is Inbox (member-first-hour.inbox.live.test.ts).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { countItems, visibleItems } from "../apps/app/src/places/vault/layout/model.ts";
import type { Item } from "../apps/app/src/places/vault/layout/model.ts";
import { LOCKED_SPACE_KEY_LINE } from "../modules/engine/locked-account.ts";
import { ADDRESS, SPACE_NAME, ask, bootHour, connectClaude, invite, join, keyStatus, messages, screen, signInGoogle, signInPassword, signOut, spaceLabels, unexpectedRefusals } from "./support/member-hour.ts";
import type { Hour, Person } from "./support/member-hour.ts";

let h: Hour;
let a: Person;
let b: Person;
const codes: Record<string, string> = {};
const given: Record<string, string> = {};

before(async () => { h = await bootHour("vault"); });
after(async () => { await h?.stop(); });

test("1 the owner invites two people by email, at the Space's own address", async () => {
  a = h.person("Aina", "aina", "aina@firm.test", "aina horse battery staple 9");
  b = h.person("Bilal", "bilal", "bilal@firm.test", "bilal horse battery staple 9");
  codes["a"] = await invite(h, a.email);
  codes["b"] = await invite(h, b.email);
  const listed = (await h.owner.call("members.invites.list", {})).invites as Array<{ email?: string; state?: string }>;
  assert.deepEqual(listed.filter((i) => i.email === a.email || i.email === b.email).length, 2, "both invitations are listed for the owner");
  // before they arrive the owner fills a Shared folder of the Space's (everyone in it is given its items), and a Restricted one only Owner and Admin reach, labelled as the app labels it
  const team = (await h.owner.call("vault.folders.create", { name: "Team keys", scope: "shared" })).folder.id as string;
  given["folder"] = team;
  await h.owner.call("vault.item.put", { folderId: team, name: "Firm_Lawmatics", kind: "api_key", fields: [{ key: "api_key", value: "lm_FAKE_team_0123456789", secret: true }] }); // secret-scan: fake
  await h.owner.call("vault.item.put", { folderId: team, name: "Firm_Westlaw", kind: "login", fields: [{ key: "username", value: "firm", secret: false }, { key: "password", value: "wl_FAKE_team_0123", secret: true }] }); // secret-scan: fake
  const partners = (await h.owner.call("vault.folders.create", { name: "Partners", scope: "shared" })).folder.id as string;
  await h.owner.call("access.labels.set", { resource: { type: "vault_folder", id: partners }, label: "restricted" });
  const clio = (await h.owner.call("vault.item.put", { folderId: partners, name: "Partners_Bank", kind: "api_key", fields: [{ key: "api_key", value: "bank_FAKE_0123456789", secret: true }] })).item.id as string; // secret-scan: fake
  await h.owner.call("access.labels.set", { resource: { type: "vault_item", id: clio }, label: "restricted" });
});

test("2 Aina joins by password in a browser; Bilal joins with Google in the Windows app", async () => {
  const ja = await join(h, a, codes["a"]!, { device: "web" });
  const jb = await join(h, b, codes["b"]!, { device: "desktop", google: true });
  for (const j of [ja, jb]) assert.equal(j.preview.spaceName, SPACE_NAME, "the invite page names the Space");
  const joined = (await h.owner.call("access.principals.list", {})).principals as Array<{ id: string }>;
  assert.ok([a, b].every((p) => joined.some((x) => x.id === p.personId)), "both are people of the Space");
});

test.todo("2b the Windows and Mac apps take the Space's own vyre.run address, which answers directly, and Bilal's invite opens in the app (l-directaddr)", async () => {
  // 3 Nov: the desktop app refused mla.vyre.run as a relay (phone) address, so a member on the Windows app could not join or sign in there
  const { inviteAppLink, isPhoneAddress } = await import("../apps/app/src/shell/session/entry.ts");
  const address = "https://mla.vyre.run";
  assert.equal(isPhoneAddress(address), false, "a Space's own address is not refused as a phone address");
  assert.ok(inviteAppLink({ kind: "join", address, code: codes["b"]!, fingerprint: "" } as never), "the invite page offers to open it in the app");
});

test("3 each signs in again later, Aina by password and Bilal by Google; the Vault is open with no prompt; they add a key and a login and every section answers", async () => {
  await signOut(a); await signOut(b);
  await signInPassword(h, a);
  await signInGoogle(h, b);
  for (const p of [a, b]) {
    assert.deepEqual(await keyStatus(h, p), { held: true, remembered: true, forgotten: false }, `${p.label}'s key is open on the server for this session`);
    // what the Vault place reads on open (generated screens vault.layout, vault.health, vault_requests.list): every read answers
    const reads = async () => ({
      items: (await screen(p, "vault.layout", "items")).items as Item[],
      folders: (await screen(p, "vault.layout", "folders")).folders as Array<{ id: string; name: string; scope: string }>,
      providers: (await screen(p, "vault.layout", "providers")).providers as Array<{ itemId?: string }>,
      health: await screen(p, "vault.health", "health"),
      requests: (await screen(p, "vault_requests.list", "requests", { state: "waiting" })).requests as unknown[],
    });
    await reads();
    // Add anything: the Mine folder the sheet makes, a key, a login
    const mine = (await p.call("vault.folders.create", { name: "Mine", scope: "mine" })).folder.id as string;
    await p.call("vault.item.put", { folderId: mine, name: `${p.label}_OpenAI`, kind: "api_key", fields: [{ key: "api_key", value: `sk-FAKE-${p.username}-0123456789abcdef`, secret: true }] }); // secret-scan: fake
    await p.call("vault.item.put", { folderId: mine, name: `${p.label}_Westlaw`, kind: "login", fields: [{ key: "username", value: p.email, secret: false }, { key: "password", value: `pw-${p.username}-FAKE-0123`, secret: true }, { key: "url", value: "https://westlaw.example.test", secret: false }] }); // secret-scan: fake
    const v = await reads();
    const providerIds = new Set(v.providers.map((x) => x.itemId ?? "").filter(Boolean));
    const health = new Set<string>();
    const names = (sel: Parameters<typeof visibleItems>[1]): string[] => visibleItems(v.items, sel, "", providerIds, health).map((i) => i.name).sort();
    const counts = countItems(v.items, providerIds, null, v.requests.length);
    assert.deepEqual(names({ kind: "keys" }).filter((n) => n.startsWith(p.label)), [`${p.label}_OpenAI`], `${p.label}'s Keys section`);
    assert.ok(names({ kind: "logins" }).includes(`${p.label}_Westlaw`), `${p.label}'s Logins section`);
    assert.deepEqual(names({ kind: "mine" }), [`${p.label}_OpenAI`, `${p.label}_Westlaw`], `${p.label}'s Mine section`);
    assert.equal(counts.mine, 2);
    // what the Space gave them is there, in its sections and in its folder's section; nothing Restricted (the Partners folder, the sign-in secret, the Space AI key) is
    assert.ok(v.folders.some((f) => f.id === given["folder"]), `${p.label}'s sidebar lists the Team keys folder: ${JSON.stringify(v.folders)}`);
    assert.deepEqual(names({ kind: "folder", folderId: given["folder"]! }), ["Firm_Lawmatics", "Firm_Westlaw"], `${p.label}'s Team keys section`);
    assert.ok(names({ kind: "keys" }).includes("Firm_Lawmatics") && names({ kind: "logins" }).includes("Firm_Westlaw"), `${p.label} finds them in Keys and Logins`);
    assert.deepEqual(names({ kind: "all" }).filter((n) => !n.startsWith(p.label) && !n.startsWith("Firm_")), [], `${p.label} sees nothing Restricted and nothing of anyone's Mine`);
  }
});

test("4 each connects their own Claude and their turn runs on it; after sign-out the Space AI key answers with the line; neither sees the other's items", async () => {
  const refs: Record<string, string> = {};
  for (const p of [a, b]) refs[p.username] = await connectClaude(p, `${p.label}_Claude`);
  for (const p of [a, b]) assert.equal((await ask(h, p, `hello from ${p.username}`)).reply, `ran for ${p.personId} on subscription ${refs[p.username]}`, `${p.label}'s turn runs on their own Claude`);

  // neither lists, reads or uses the other's
  for (const [p, q] of [[a, b], [b, a]] as const) {
    const accounts = (await p.call("engine.accounts.list")).accounts as Array<{ ref: string }>;
    assert.ok(!accounts.some((x) => x.ref === refs[q.username]), `${q.label}'s Claude is not among ${p.label}'s accounts`);
    const items = ((await p.call("vault.items.list", {})).items as Item[]).map((i) => i.name);
    assert.ok(!items.some((n) => n.startsWith(q.label)), `${p.label} sees none of ${q.label}'s items: ${JSON.stringify(items)}`);
    await p.refused("vault.use", { item: `${q.label}_OpenAI` }, /^permission\.|^validation\.(not_found|bad_input)$/, `${p.label} cannot use ${q.label}'s key`);
  }

  // a session that never handed the key over (their phone), then they sign out of the one that did: the turn falls back to the Space AI key and the chat says why in one line
  for (const p of [a, b]) {
    const phone = h.person(p.label, p.username, p.email, p.password);
    phone.personId = p.personId;
    phone.token = (await phone.call("identity.sign_in", { username: p.username, password: p.password, deviceName: "Phone", deviceClass: "phone" })).session.token as string;
    await signOut(p);
    const after = await ask(h, phone, `hello again from ${p.username}`);
    assert.equal(after.reply, `ran for ${p.personId} on the space key`, `${p.label}'s turn fell back to the Space AI key`);
    const lines = (await messages(h, phone, after.threadId)).flatMap((m) => m.blocks ?? []).filter((x) => x.type === "turn_status").map((x) => x.data?.text);
    assert.ok(lines.includes(LOCKED_SPACE_KEY_LINE), `${p.label}'s chat says why: ${JSON.stringify(lines)}`);
    p.token = phone.token;
    p.seen.push(...phone.seen);
  }
});

test("9 every Space label the app shows them is the name, never an spc_ id", async () => {
  for (const p of [a, b, h.owner]) await spaceLabels(p);
  assert.equal(new URL(ADDRESS).hostname, "mla.firm.test");
});

test("10 no call their screens made was refused unless it was meant and said in plain words", () => {
  assert.deepEqual(unexpectedRefusals(h, [a, b]), []);
});
