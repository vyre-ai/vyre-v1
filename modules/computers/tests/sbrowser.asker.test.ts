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
