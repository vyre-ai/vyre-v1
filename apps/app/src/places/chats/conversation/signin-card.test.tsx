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
      openComputer={(id) => void opened.push(`computer ${id}`)}
      answer={(id, a) => void answers.push([id, a])}
      {...extra}
    />
  );
  return { el, answers, opened };
}

test("someone who may take over sees Open terminal, Done and I can't; Open terminal opens the agent's computer; Done answers and collapses", async () => {
  const r = rig({ access: "owner" });
  const c = card(r);
  const root = await mount(createRoot, c.el);
  await flush();
  assert.match(textOf(find(root, "signin-card-blk_1")), /Dex needs you to sign in/);
  assert.match(textOf(find(root, "signin-card-why-blk_1")), /GitHub/);
  await press(find(root, "signin-card-open-blk_1"));
  assert.deepEqual(
    c.opened,
    ["computer agt_1"],
    "Open terminal opens the agent's Computer tab, where its terminals are",
  );
  await press(find(root, "signin-card-done-btn-blk_1"));
  assert.deepEqual(c.answers, [["blk_1", "done"]]);
  assert.match(textOf(find(root, "signin-card-done-blk_1")), /signed in, \d/);
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

test("a sign-in card is never in the dock above the composer, where anyone in the chat would be offered the answer", async () => {
  const { openQuestions } = await import("./island.ts");
  const msg = (card: unknown) =>
    ({
      id: "msg_1",
      author: { kind: "agent", id: "agt_1" },
      createdAt: 1,
      blocks: [
        {
          id: "blk_1",
          type: "question",
          state: "waiting",
          data: { prompt: "Sign in to GitHub", mode: "single", options: [{ key: "done", label: "Done" }], card },
        },
      ],
    }) as never;
  assert.equal(openQuestions([msg({ kind: "signin", surface: "terminal", agentId: "agt_1" })]).length, 0);
  assert.equal(openQuestions([msg(undefined)]).length, 1, "an ordinary question still is");
});

test("the collapsed card says who signed in and when, plainly; the line sent to the agent is not shown to people", async () => {
  const { signinDoneLine } = await import("./SigninCard.tsx");
  const { isSigninAnswerLine } = await import("./model.ts");
  const at = new Date(2026, 10, 27, 23, 9).getTime();
  const whenStub = (t: number): string =>
    new Date(t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }) && "11:09 PM";
  assert.match(
    signinDoneLine({ answer: "done", answeredBy: "usr_owner", answeredAt: at }, "usr_me", nameOf, whenStub),
    /^Dana signed in, 11:09/,
  );
  assert.match(
    signinDoneLine({ answer: "cannot", answeredBy: "usr_me", answeredAt: at }, "usr_me", nameOf, whenStub),
    /^usr_me couldn't sign in, 11:09/,
  );
  assert.equal(
    signinDoneLine({ answer: "done", answeredBy: "usr_owner" }, "usr_me", nameOf, whenStub),
    "Dana signed in",
    "no time when the server did not say",
  );
  const person = { kind: "person" };
  assert.equal(isSigninAnswerLine({ body: "Answered: Done, I signed in (done)", author: person }), true);
  assert.equal(isSigninAnswerLine({ body: "Answered: I can't sign in (cannot)", author: person }), true);
  assert.equal(
    isSigninAnswerLine({ body: "Answered: Federal (b)", author: person }),
    false,
    "other answers stay as they are",
  );
  assert.equal(isSigninAnswerLine({ body: "Answered: Done, I signed in (done)", author: { kind: "agent" } }), false);
  // the words are the ones lib/signin-card.ts sends
  const { SIGNIN_OPTIONS } = await import("../../../../../../lib/signin-card.ts");
  for (const o of SIGNIN_OPTIONS)
    assert.equal(isSigninAnswerLine({ body: `Answered: ${o.label} (${o.key})`, author: person }), true, o.key);
});
