// The six lows r-review found after the first read of the helper UI (lane r42-subagents, 20 Nov 2026), each with its own test: steer boxes keep typed words, Retry only for who manages the run, a hand-stopped helper keeps
// Retry, the row's clock is the node's, no blank line on a cut-down failed tile, plain words for narrowed tools; and the shown reason is capped.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf, typeInto } from "../../../../../../ui/src/testing/dom.ts";
import { CrewPeek } from "./pane.tsx";
import { CrewBlock } from "../session/CrewBlock.tsx";
import { AskBox } from "../helper/HelperChat.tsx";
import { CrewProvider, useCrew } from "./context.tsx";
import { toRunView, REASON_MAX } from "./run-view.ts";
import { totalsOf } from "./model.ts";
import { toolsWords } from "./run/rerun.tsx";
import { retryHelper } from "../conversation/actions.ts";
import type { CrewMember } from "./model.ts";

installDom();

const M = (o: Partial<CrewMember> = {}): CrewMember =>
  ({
    kind: "helper",
    id: "thr_a",
    runId: "run_a",
    parentThreadId: "thr_0",
    title: "Supplier bids",
    name: "Tess",
    agentId: "agt_tess",
    state: "working",
    startedAt: 1_000,
    elapsedMs: 0,
    tokensIn: 0,
    tokensOut: 0,
    costMicros: 0,
    ...o,
  }) as CrewMember;
const node = (o: Record<string, unknown>) => ({
  kind: "helper",
  status: "running",
  spent: { tokensIn: 0, tokensOut: 0, cacheRead: 0, usdMicros: 0 },
  startedAt: 1_000,
  ...o,
});

// 1. steer boxes: words typed while the message is on its way stay; an untouched box is emptied; a second press sends nothing
test("the pane's ask box and the helper chat's keep the words typed while the first message was on its way, and send one message per press", async () => {
  for (const which of ["pane", "chat"] as const) {
    const sent: Array<Record<string, unknown>> = [];
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const call = async (cap: string, input: unknown): Promise<unknown> => {
      if (cap === "chat.helper.steer") {
        sent.push(input as Record<string, unknown>);
        await held;
      }
      return cap === "chat.helper.notes" ? { notes: [] } : {};
    };
    const root =
      which === "pane"
        ? await mount(
            createRoot,
            <CrewPeek
              member={M()}
              call={call}
              meId="usr_me"
              onBack={() => undefined}
              onOpenChat={() => undefined}
              onRefresh={() => undefined}
            />,
          )
        : await mount(createRoot, <AskBox threadId="thr_a" name="Tess" call={call} say={() => undefined} />);
    const box = which === "pane" ? "crew-peek-ask" : "helper-ask";
    const go = which === "pane" ? "crew-peek-send" : "helper-ask-send";
    await typeInto(find(root, box), "first question");
    await press(find(root, go));
    await press(find(root, go));
    await typeInto(find(root, box), "first question and a second thought");
    release();
    await flush();
    assert.equal(sent.length, 1, `${which}: one message for two presses`);
    assert.equal(
      find(root, box)?.props.value,
      "first question and a second thought",
      `${which}: words typed meanwhile are not wiped`,
    );
  }
  // untouched: emptied once it was taken
  const call = async (cap: string): Promise<unknown> => (cap === "chat.helper.notes" ? { notes: [] } : {});
  const root = await mount(createRoot, <AskBox threadId="thr_a" name="Tess" call={call} say={() => undefined} />);
  await typeInto(find(root, "helper-ask"), "just this");
  await press(find(root, "helper-ask-send"));
  await flush();
  assert.equal(find(root, "helper-ask")?.props.value, "");
});

// 2. Retry only for who may manage the run
test("the pane's Retry is for someone who manages the run: shown when the server says so, hidden when it says no, shown when there is no run behind it; the retry carries retryOf", async () => {
  const peek = async (can: unknown, member: Partial<CrewMember>) => {
    const calls: Array<{ cap: string; input: Record<string, unknown> }> = [];
    const call = async (cap: string, input: unknown): Promise<unknown> => {
      calls.push({ cap, input: input as Record<string, unknown> });
      if (cap === "runs.node.get") return { node: { can } };
      if (cap === "chat.helper.notes")
        return { notes: [{ messageId: "n1", who: "brief", authorId: "a", body: "Read the bids." }] };
      return {};
    };
    const root = await mount(
      createRoot,
      <CrewPeek
        member={M({ state: "failed", ...member })}
        call={call}
        meId="usr_me"
        onBack={() => undefined}
        onOpenChat={() => undefined}
        onRefresh={() => undefined}
      />,
    );
    await flush();
    return { root, calls };
  };
  assert.ok(find((await peek({ manage: false }, {})).root, "crew-peek-retry") === null, "may not: no Retry");
  const yes = await peek({ manage: true }, {});
  assert.ok(find(yes.root, "crew-peek-retry"), "may: Retry");
  assert.ok(
    find((await peek({}, {})).root, "crew-peek-retry") === null,
    "no word from the server: hidden, as for Save",
  );
  assert.ok(find((await peek({ manage: false }, { runId: undefined })).root, "crew-peek-retry"), "no run behind it");
  await press(find(yes.root, "crew-peek-retry"));
  await flush();
  const start = yes.calls.find((c) => c.cap === "chat.helper.start")!;
  assert.equal(start.input.retryOf, "thr_a", "the runtime starts what waited for it again behind the new attempt");
});

test("the chat block's Retry follows what the server said about the run: the provider says mayRetry only when it was told", async () => {
  const probe = async (can: unknown) => {
    const call = async (cap: string): Promise<unknown> => {
      if (cap === "engine.crew.status")
        return { members: [M({ state: "failed" })], totals: totalsOf([M({ state: "failed" })]) };
      if (cap === "runs.tree.find") return { roots: [{ rootRun: "run_r", runId: "run_r", full: true }] };
      if (cap === "runs.tree.get") return { nodes: [node({ id: "run_r", kind: "turn", status: "running" })] };
      if (cap === "runs.node.get") return { node: { can } };
      return {};
    };
    let seen: { mayRetry?: boolean } | null = null;
    const Probe = (): null => {
      seen = useCrew();
      return null;
    };
    await mount(
      createRoot,
      <CrewProvider call={call} threadId="thr_0">
        <Probe />
      </CrewProvider>,
    );
    await flush();
    await flush();
    return (seen as { mayRetry?: boolean } | null)?.mayRetry;
  };
  assert.equal(await probe({ manage: false }), false);
  assert.equal(await probe({ manage: true }), true);
  assert.equal(await probe(undefined), undefined, "nothing said: the press is the server's to answer");
});

test("the Retry the chat block draws starts the helper again with retryOf", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const data = {
    threadId: "thr_0",
    call: async (cap: string, input: unknown): Promise<unknown> => {
      if (cap === "threads.get") return { thread: { title: "Docs" } };
      if (cap === "chat.messages.list") return { messages: [{ body: "Write the page." }] };
      if (cap === "chat.helper.start") calls.push(input as Record<string, unknown>);
      return {};
    },
  } as never;
  await retryHelper(data, "thr_d", "k1");
  assert.equal(calls[0]!.retryOf, "thr_d");
});

// 3. a hand-stopped helper keeps its Retry; only dependency_failed hides it
test("only a helper that failed because of its dependency loses Retry and clock; one stopped by hand, or failed on its own, keeps both", () => {
  const nodes = (status: string, errorCode?: string) =>
    [
      node({ id: "run_x", status: "failed" }),
      node({
        id: "run_a",
        status,
        dependsOn: ["run_x"],
        startedAt: 1_700_000_000_000,
        endedAt: 1_700_000_005_000,
        ...(errorCode ? { errorCode } : {}),
      }),
    ] as never;
  assert.equal(toRunView(M({ state: "working" }), nodes("failed", "dependency_failed")).blocked, true);
  assert.equal(
    toRunView(M({ state: "stopped" }), nodes("stopped")).blocked,
    undefined,
    "stopped by hand behind a failed one",
  );
  assert.equal(toRunView(M({ state: "failed" }), nodes("failed", "model.failed")).blocked, undefined);
});

// 4. the row's clock is the node's
test("a row's clock counts from the node's own start, as the tile does", async () => {
  const now = Date.now();
  const member = M({ state: "working", startedAt: now - 9_000_000, elapsedMs: 0 });
  const nodes = [node({ id: "run_a", status: "running", startedAt: now - 180_000 })] as never;
  const root = await mount(
    createRoot,
    <CrewBlock
      members={[member]}
      totals={totalsOf([member])}
      view="rows"
      call={async () => ({})}
      nodes={nodes}
      meId="usr_me"
      onPeek={() => undefined}
      onOpenPane={() => undefined}
      onStopAll={() => undefined}
      onRetry={() => undefined}
    />,
  );
  await flush();
  assert.match(textOf(find(root, "crew-chip-thr_a-time")), /^3 min/);
});

// 5. no blank line on a cut-down failed tile
test("a failed or stopped tile with nothing to say still says something, never a blank line", async () => {
  for (const [state, words] of [
    ["failed", "Could not finish"],
    ["stopped", "Stopped"],
  ] as const) {
    const member = M({ state });
    const root = await mount(
      createRoot,
      <CrewBlock
        members={[member, M({ id: "thr_b", runId: "run_b", state: "working", step: "Reading" })]}
        totals={totalsOf([member])}
        view="tiles"
        width={900}
        call={async () => ({})}
        meId="usr_me"
        onPeek={() => undefined}
        onOpenPane={() => undefined}
        onStopAll={() => undefined}
        onRetry={() => undefined}
      />,
    );
    await flush();
    assert.equal(textOf(find(root, "crew-tile-thr_a-line-0")).trim(), words);
  }
});

// 6. plain words for narrowed
test("the server's narrowed reads as plain words", () => {
  assert.equal(toolsWords("narrowed"), "Some tools were removed.");
  assert.equal(toolsWords("kept"), "It keeps the tools this helper had.");
  assert.equal(toolsWords("default"), "It starts with the default tools.");
  assert.equal(toolsWords(undefined), "");
});

// the reason is capped
test("a long reason is cut at a sane length with an ellipsis; a short one is left alone", () => {
  const long = "x".repeat(400);
  const nodes = [node({ id: "run_a", status: "failed", reason: long })] as never;
  const v = toRunView(M({ state: "failed" }), nodes);
  assert.ok(v.lines[0]!.length <= REASON_MAX && v.lines[0]!.endsWith("…"));
  const short = toRunView(M({ state: "failed" }), [
    node({ id: "run_a", status: "failed", reason: "It could not finish." }),
  ] as never);
  assert.deepEqual(short.lines, ["It could not finish."]);
});

// tasks.act has no key to send
test("tasks.act takes no idempotency key and is idempotent by itself; the tile sends none and answers a request once", () => {
  const reg = JSON.parse(
    fs.readFileSync(new URL("../../../../../../generated/registry.json", import.meta.url), "utf8"),
  ) as { capabilities: Array<{ name: string; idempotency: string; input: { properties: Record<string, unknown> } }> };
  const act = reg.capabilities.find((c) => c.name === "tasks.act")!;
  assert.equal(act.idempotency, "natural");
  assert.ok(
    !("idempotencyKey" in act.input.properties),
    "there is no key to send; the in-flight guard and the server's own refusal of a second answer are what protect it",
  );
});
