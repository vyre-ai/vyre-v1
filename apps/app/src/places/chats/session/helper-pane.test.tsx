// A helper's pane (owner, 6 Nov 2026, prototype t-session): the peek with the files it changed, and a "helper: <name>" terminal tab only when the helper works in a workspace of its own.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { HelperPane, terminalTitle } from "./HelperPane.tsx";
import type { CrewMember } from "../crew/model.ts";
import type { TerminalData } from "../terminal/data.ts";

installDom();

const tess = { kind: "teammate", id: "thr_t", parentThreadId: "thr_0", title: "Server fixes", name: "Tess", agentId: "agt_t", state: "working", step: "Running the install tests", startedAt: 1_000, elapsedMs: 5_000, tokensIn: 0, tokensOut: 0, costMicros: 0, branch: "crew/tess", added: 86, deleted: 16, files: [{ path: "images/vyred/compose.server.yml", added: 5, deleted: 0 }, { path: "scripts/install/linux/vyre-server", added: 81, deleted: 16 }] } as CrewMember;

function rig(workspace: unknown, opens: Array<{ cap: string; input: unknown }>): { call: (cap: string, input: unknown) => Promise<unknown>; term: TerminalData } {
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    if (cap === "engine.crew.workspace") return { workspace };
    if (cap === "terminal.list") return { terminals: [] };
    if (cap === "terminal.open_server" || cap === "terminal.open") { opens.push({ cap, input }); throw new Error("no server here"); }
    if (cap === "chat.helper.notes") return { notes: [] };
    if (cap === "chat.messages.list") return { messages: [{ blocks: [{ id: "s1", type: "step", v: 1, state: "done", data: { title: "Ran the install tests" } }] }] };
    return {};
  };
  const term = { call, screens: {}, connection: { get: () => "online", subscribe: () => () => undefined }, space: { id: "s", name: "Northwind" }, newKey: () => "k", clock: () => ({ now: 1, offsetMin: 0 }), nav: {} } as unknown as TerminalData;
  return { call, term };
}

test("a helper with no workspace is the plain peek: its steps and the files it changed, no terminal tab", async () => {
  const { call, term } = rig(null, []);
  const root = await mount(createRoot, <HelperPane member={tess} call={call} terminal={term} onBack={() => undefined} onOpenChat={() => undefined} onRefresh={() => undefined} />);
  assert.equal(find(root, "helper-pane"), null, "no tab strip");
  assert.ok(find(root, "crew-peek"));
  assert.match(textOf(find(root, "crew-file-images/vyred/compose.server.yml")), /compose\.server\.yml/);
  assert.match(textOf(find(root, "crew-file-scripts/install/linux/vyre-server")), /\+\s*81/);
  assert.ok(textOf(find(root, "crew-peek")).includes("Ran the install tests"), "its last steps");
});

test("a helper in a workspace has a terminal tab named for it, which offers to open one in the workspace", async () => {
  const opens: Array<{ cap: string; input: unknown }> = [];
  const { call, term } = rig({ jobId: "crw_1", repo: "/srv/vyre/repo", base: "main", branch: "crew/tess", name: "Tess" }, opens);
  assert.equal(terminalTitle(tess), "helper: Tess");
  const root = await mount(createRoot, <HelperPane member={tess} call={call} terminal={term} onBack={() => undefined} onOpenChat={() => undefined} onRefresh={() => undefined} />);
  assert.ok(find(root, "helper-pane"), "the tab strip");
  assert.match(textOf(find(root, "tab-strip")), /helper: Tess/);
  await press(find(root, "tab-term"));
  await flush();
  assert.ok(find(root, "helper-terminal-none"), "no session yet");
  await press(find(root, "helper-terminal-open"));
  await flush();
  assert.deepEqual(opens[0], { cap: "terminal.open_server", input: { name: "helper: Tess", cwd: "/srv/vyre/repo", idempotencyKey: "k" } });
  await press(find(root, "tab-helper"));
  assert.ok(find(root, "crew-peek"), "back on the thread tab");
});

test("without a terminal in the shell there is no tab, even for a helper in a workspace", async () => {
  const { call } = rig({ jobId: "crw_1", repo: "/srv/r", base: "main", branch: "b", name: "Tess" }, []);
  const root = await mount(createRoot, <HelperPane member={tess} call={call} onBack={() => undefined} onOpenChat={() => undefined} onRefresh={() => undefined} />);
  assert.equal(find(root, "helper-pane"), null);
});
