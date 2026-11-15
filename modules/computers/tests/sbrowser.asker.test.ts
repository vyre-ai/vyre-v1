// A person who uses a shared agent without owning it browses in a profile of their own (owner, 13 Nov 2026, P7 section 10 item 6: "uses only the sign-ins the asker may use"). Unit level, with a stand-in
// browser: which profile a turn uses (the agent's own for its owner, its Assistant's person and a turn for nobody; one per other person), that the id is a valid profile id and the same every time, that a
// person who may not use a site's sign-in never reaches the profile that holds it, and where their downloads go.
import test from "node:test";
import assert from "node:assert/strict";
import { bindFill, bindKit, bindPersonalChrome } from "../projections.ts";
import { bindSpaceBrowser } from "../sbrowser/port.ts";
import { resetAgentInfo } from "../sbrowser/agentinfo.ts";
import type { BrowserToolCall, SpaceBrowser } from "../sbrowser/port.ts";
import { PROFILE_ID as BROWSERD_PROFILE_ID } from "../../../images/space-browser/browserd/profiles.ts";
import { PROFILE_ID, askerProfileId, profileIdOf } from "../sbrowser/policy.ts";
import { hasOwnPlace } from "../../../lib/asker-place.ts";
import { harness } from "../fixtures/harness.ts";
import { tool } from "./tools.fixture.ts";

const AG = "agt_01a1d4e073004405af63151b48dcb667";
const MAYA = "usr_maya";
const ANA = "usr_01a1d4e07ba64d15997a5f4bfa477a85";
const BEN = "usr_ben";
const AG2 = "agt_01a1d4e073004405af63151b48dcb999";

test("a profile id of a person on an agent is a valid profile id, the same every time, different for every person and never the agent's own", () => {
  const a = askerProfileId(AG, ANA)!;
  const b = askerProfileId(AG, BEN)!;
  assert.ok(PROFILE_ID.test(a) && BROWSERD_PROFILE_ID.test(a), "a profile id for both rules");
  assert.equal(a, askerProfileId(AG, ANA), "found again after sleep, restart and update");
  assert.notEqual(a, b);
  assert.notEqual(a, profileIdOf(AG));
  assert.ok(a.startsWith(`${AG}-`), a);
  // a person id a folder name cannot carry, or one that is too long, still gives a valid and distinct id
  const odd = askerProfileId(AG, `usr_${"x".repeat(80)}`)!;
  assert.ok(BROWSERD_PROFILE_ID.test(odd), odd);
  assert.notEqual(odd, askerProfileId(AG, `usr_${"x".repeat(79)}y`));
  assert.equal(askerProfileId("not a valid id!", ANA), null);
});

test("who has a place of their own: everyone but the agent's owner, a person's Assistant, an outside agent and nobody", () => {
  const dex = { ownerId: MAYA, kind: "agent" };
  assert.equal(hasOwnPlace(dex, AG, ANA), true);
  assert.equal(
    hasOwnPlace(dex, AG, MAYA),
    false,
    "the owner keeps the agent's own place: what was signed in before is theirs",
  );
  assert.equal(hasOwnPlace(dex, AG, undefined), false, "a turn for nobody");
  assert.equal(hasOwnPlace(dex, AG, AG), false, "the agent itself");
  assert.equal(hasOwnPlace({ ownerId: MAYA, kind: "assistant" }, AG, ANA), false);
  assert.equal(hasOwnPlace({ ownerId: MAYA, kind: "agent", runtime: "outside" }, AG, ANA), false);
  assert.equal(hasOwnPlace({ kind: "agent" }, AG, ANA), false, "owner unknown: nothing changes");
  assert.equal(hasOwnPlace(undefined, AG, ANA), false);
});

function browser() {
  const calls: BrowserToolCall[] = [];
  const sb = {
    async available() {
      return true;
    },
    async tool(a: BrowserToolCall) {
      calls.push(a);
      return { url: "https://example.com/", title: "Example", tabId: "t1", loading: false };
    },
    async downloads() {
      return [{ name: "a.txt", size: 4, at: 1 }];
    },
    async downloadRead() {
      return new TextEncoder().encode("abcd");
    },
    async downloadAck() {},
    async sessions(profileId: string) {
      return [{ site: `site-of-${profileId.slice(-8)}.test`, since: 1, lastSeen: 2 }];
    },
    async profileUsed() {
      return false;
    },
    async screenshot() {
      return { bytes: new Uint8Array([1, 2, 3]), width: 1, height: 1 };
    },
    async profiles() {
      return { profiles: [], maxRunning: 6 };
    },
    async health() {
      return { ok: true };
    },
  } as unknown as SpaceBrowser;
  bindSpaceBrowser(sb);
  return calls;
}
const off = (): void => {
  resetAgentInfo();
  bindSpaceBrowser(null);
  bindFill(null);
  bindKit(null);
  bindPersonalChrome(null);
};
function turn(
  asker: string | undefined,
  facts: { ownerId?: string; kind?: string },
  files: Array<{ cap: string; input: unknown }> = [],
  agent = AG,
) {
  resetAgentInfo();
  const h = harness({ principal: { kind: "agent", id: agent }, ...(asker === undefined ? {} : { actingFor: asker }) });
  h.respond["agents.get"] = () => ({ agent: { agentId: agent, name: "Dex", folderId: "fld_dex", ...facts } });
  h.respond["files.tree"] = () => ({ roots: [{ key: "personal", folderId: `fld_personal_of_${asker}` }] });
  h.respond["files.folder.create"] = (i) => {
    files.push({ cap: "files.folder.create", input: i });
    return { folder: { folderId: `fld_dl_${String((i as { parentId?: string }).parentId)}` } };
  };
  h.respond["files.create"] = (i) => {
    files.push({ cap: "files.create", input: i });
    return { file: { fileId: "fil_dl" } };
  };
  return h.ctx;
}

test("a turn browses in its person's own profile: the agent's for its owner and for nobody, one each for the others, so Ben never browses as Ana", async () => {
  const calls = browser();
  const dex = { ownerId: MAYA, kind: "agent" };
  try {
    await tool["computers.chrome.open"]!(turn(ANA, dex), { url: "https://bank.test/login" });
    await tool["computers.chrome.open"]!(turn(BEN, dex), { url: "https://bank.test/account" });
    await tool["computers.chrome.open"]!(turn(MAYA, dex), { url: "https://bank.test/" });
    await tool["computers.chrome.open"]!(turn(undefined, dex), { url: "https://bank.test/" });
    await tool["computers.chrome.open"]!(turn(ANA, { ownerId: MAYA, kind: "assistant" }), {
      url: "https://bank.test/",
    });
    assert.deepEqual(
      calls.map((c) => c.profileId),
      [askerProfileId(AG, ANA), askerProfileId(AG, BEN), AG, AG, AG],
      "Ana, Ben, the owner, nobody, an Assistant",
    );
    assert.notEqual(calls[0]!.profileId, calls[1]!.profileId, "Ben's turn is not in the profile Ana signed in to");
  } finally {
    off();
  }
});

test("what a person's turn downloads goes into that person's own Files, never the agent's shared folder; the owner's still goes to the agent's Downloads", async () => {
  browser();
  const dex = { ownerId: MAYA, kind: "agent" };
  try {
    const mine: Array<{ cap: string; input: unknown }> = [];
    const out = await tool["computers.chrome.open"]!(turn(BEN, dex, mine, AG2), { url: "https://x.test/file" });
    void out;
    const folder = mine.find((x) => x.cap === "files.folder.create")?.input as { parentId?: string } | undefined;
    assert.equal(folder?.parentId, `fld_personal_of_${BEN}`, "Ben's own Files");
    const owner: Array<{ cap: string; input: unknown }> = [];
    await tool["computers.chrome.open"]!(turn(MAYA, dex, owner, AG2), { url: "https://x.test/file" });
    assert.equal(
      (owner.find((x) => x.cap === "files.folder.create")?.input as { parentId?: string }).parentId,
      "fld_dex",
      "the agent's folder",
    );
  } finally {
    off();
  }
});

test("the pictures of a person's browsing of a shared agent are kept in that person's own Files, the owner's in the agent's folder", async () => {
  browser();
  const dex = { ownerId: MAYA, kind: "agent" };
  const AG3 = "agt_01a1d4e073004405af63151b48dcb777";
  try {
    const mine: Array<{ cap: string; input: unknown }> = [];
    await tool["computers.chrome.open"]!(turn(BEN, dex, mine, AG3), { url: "https://x.test/page" });
    const bens = mine.filter((x) => x.cap === "files.create" && (x.input as { mime?: string }).mime === "image/png");
    assert.equal(bens.length > 0, true, "a picture of the step was kept");
    assert.equal((bens[0]!.input as { folderId?: string }).folderId, `fld_personal_of_${BEN}`, "in Ben's own Files");
    const owner: Array<{ cap: string; input: unknown }> = [];
    await tool["computers.chrome.open"]!(turn(MAYA, dex, owner, AG3), { url: "https://x.test/page" });
    const hers = owner.filter((x) => x.cap === "files.create" && (x.input as { mime?: string }).mime === "image/png");
    assert.equal((hers[0]!.input as { folderId?: string }).folderId, "fld_dex", "the agent's folder, as before");
  } finally {
    off();
  }
});

test("the first call in a person's own profile says in one plain line that what others signed in to is not signed in there; the owner's profile says nothing", async () => {
  browser();
  const dex = { ownerId: MAYA, kind: "agent" };
  const AG4 = "agt_01a1d4e073004405af63151b48dcb888";
  try {
    const first = await tool["computers.chrome.open"]!(turn(BEN, dex, [], AG4), { url: "https://x.test/" });
    assert.match(String(first.note), /your own browser profile on this agent/);
    assert.match(String(first.note), /someone else signed in to is not signed in here/);
    const owner = await tool["computers.chrome.open"]!(turn(MAYA, dex, [], AG4), { url: "https://x.test/" });
    assert.equal(owner.note, undefined);
  } finally {
    off();
  }
});

test("a person's own sign-in list is their own profile's: the agent's own for its owner, theirs for anyone else, never another person's", async () => {
  browser();
  const AG5 = "agt_01a1d4e073004405af63151b48dcb555";
  try {
    const ask = async (person: string) => {
      resetAgentInfo();
      const h = harness({ principal: { kind: "person", id: person } });
      h.respond["agents.get"] = () => ({
        agent: { agentId: AG5, name: "Dex", folderId: "f", ownerId: MAYA, kind: "agent" },
      });
      return tool["computers.browser.my_sign_ins"]!(h.ctx, { agentId: AG5 });
    };
    const ben = await ask(BEN);
    assert.equal(ben.profile, "own");
    assert.match(ben.signIns[0].site, new RegExp(`site-of-${askerProfileId(AG5, BEN)!.slice(-8)}`));
    const maya = await ask(MAYA);
    assert.equal(maya.profile, "agent");
    assert.match(maya.signIns[0].site, new RegExp(`site-of-${AG5.slice(-8)}`));
  } finally {
    off();
  }
});
