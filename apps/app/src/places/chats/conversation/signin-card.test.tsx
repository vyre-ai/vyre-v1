// The sign-in hand-off card (rc.44): one card for the terminal and the browser. The people who may take over see Open terminal or Open browser and the two answers, everyone else sees who the agent waits for
// and no button; Done and I can't answer the question and collapse the card; a question carries the card only when it says so.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { SigninCard, whoMayTakeOver } from "./SigninCard.tsx";
import { signinAskOf } from "./model.ts";

installDom();

test("a question carries a sign-in card only when it says where and whose computer", () => {
  assert.deepEqual(
    signinAskOf({ card: { kind: "signin", surface: "terminal", agentId: "agt_1", terminalId: "trm_1" } }),
    {
      surface: "terminal",
      agentId: "agt_1",
      terminalId: "trm_1",
    },
  );
  assert.deepEqual(
    signinAskOf({ card: { kind: "signin", surface: "browser", agentId: "agt_1", site: "github.com" } }),
    {
      surface: "browser",
      agentId: "agt_1",
      site: "github.com",
    },
  );
  assert.equal(signinAskOf({ card: { kind: "signin", surface: "nowhere", agentId: "agt_1" } }), null);
  assert.equal(signinAskOf({ card: { kind: "signin", surface: "browser" } }), null);
  assert.equal(signinAskOf({ card: { kind: "terminal", command: "ls" } }), null);
  assert.equal(signinAskOf({ prompt: "Which?" }), null);
});

const rig = (o: { access?: string; owner?: string; fail?: boolean }) => {
  const calls: string[] = [];
  const call = async (cap: string): Promise<unknown> => {
    calls.push(cap);
    if (o.fail) throw new Error("down");
    if (cap === "computers.browser.profiles")
      return { profiles: o.access ? [{ agentId: "agt_1", access: o.access }] : [] };
    if (cap === "agents.share_class") return { class: "shared", ownerId: o.owner ?? "usr_owner", people: [] };
    return {};
  };
  return { calls, call };
};
const nameOf = (id: string): string => (id === "usr_owner" ? "Dana" : id);

test("who may take over: the profile says owner or admin; otherwise the agent's owner is read; a viewer waits for the owner by name; an unreadable answer shows the waiting line", async () => {
  assert.deepEqual(await whoMayTakeOver(rig({ access: "admin" }).call, "agt_1", "usr_me", nameOf), { s: "may" });
  assert.deepEqual(await whoMayTakeOver(rig({ owner: "usr_me" }).call, "agt_1", "usr_me", nameOf), { s: "may" });
  assert.deepEqual(await whoMayTakeOver(rig({ access: "viewer" }).call, "agt_1", "usr_me", nameOf), {
    s: "wait",
    for: "Dana",
  });
  assert.deepEqual(await whoMayTakeOver(rig({ fail: true }).call, "agt_1", "usr_me", nameOf), {
    s: "wait",
    for: "the owner",
  });
});

function card(r: ReturnType<typeof rig>, extra: Partial<Parameters<typeof SigninCard>[0]> = {}) {
  const answers: unknown[] = [];
  const opened: string[] = [];
  const el = (
    <SigninCard
      id="blk_1"
      why="Sign in to GitHub with the code the terminal shows"
      surface="terminal"
      agentId="agt_1"
      terminalId="trm_1"
      name="Dex"
      call={r.call}
      me="usr_me"
      nameOf={nameOf}
      openTerminal={(id) => void opened.push(`terminal ${id}`)}
      openComputer={(id) => void opened.push(`computer ${id}`)}
      answer={(id, a) => void answers.push([id, a])}
      {...extra}
    />
  );
  return { el, answers, opened };
}

test("someone who may take over sees Open terminal, Done and I can't; Open terminal opens that terminal; Done answers and collapses", async () => {
  const r = rig({ access: "owner" });
  const c = card(r);
  const root = await mount(createRoot, c.el);
  await flush();
  assert.match(textOf(find(root, "signin-card-blk_1")), /Dex needs you to sign in/);
  assert.match(textOf(find(root, "signin-card-why-blk_1")), /GitHub/);
  await press(find(root, "signin-card-open-blk_1"));
  assert.deepEqual(c.opened, ["terminal trm_1"]);
  await press(find(root, "signin-card-done-btn-blk_1"));
  assert.deepEqual(c.answers, [["blk_1", "done"]]);
  assert.match(textOf(find(root, "signin-card-done-blk_1")), /Signed in/);
});

test("the browser card opens the agent's computer, and I can't answers cannot", async () => {
  const r = rig({ access: "owner" });
  const c = card(r, { surface: "browser", terminalId: undefined, site: "github.com" });
  const root = await mount(createRoot, c.el);
  await flush();
  assert.match(textOf(find(root, "signin-card-why-blk_1")), /github\.com/);
  assert.match(textOf(find(root, "signin-card-open-blk_1")), /Open browser/);
  await press(find(root, "signin-card-open-blk_1"));
  assert.deepEqual(c.opened, ["computer agt_1"]);
  await press(find(root, "signin-card-cannot-blk_1"));
  assert.deepEqual(c.answers, [["blk_1", "cannot"]]);
});

test("someone who may not take over sees who the agent waits for and no button at all", async () => {
  const r = rig({ access: "viewer" });
  const c = card(r);
  const root = await mount(createRoot, c.el);
  await flush();
  assert.match(textOf(find(root, "signin-card-wait-blk_1")), /Waiting for Dana to sign in/);
  assert.equal(find(root, "signin-card-open-blk_1"), null);
  assert.equal(find(root, "signin-card-done-btn-blk_1"), null);
  assert.equal(find(root, "signin-card-cannot-blk_1"), null);
});
