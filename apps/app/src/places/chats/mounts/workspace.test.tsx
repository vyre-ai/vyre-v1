// A work chat is a workspace: wide, the conversation is a column beside the work; narrow, it is a drawer over the work with a toggle. Tasks and runs have workspaces like records.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { Workspace } from "./Workspace.tsx";
import type { ShellRuntime } from "../../../shell/providers/runtime.tsx";

const rt = { call: async () => ({}), open: () => undefined } as unknown as ShellRuntime;
const html = (narrow: boolean, type: "run" | "record"): string => renderToStaticMarkup(<Workspace rt={rt} work={{ type, id: "run_1" }} narrow={narrow}><span>CONVERSATION</span></Workspace>).replaceAll("<!-- -->", "");

test("wide: the work and the conversation sit side by side, with no drawer button", () => {
  const out = html(false, "run");
  assert.ok(out.includes('data-testid="chats-work"') && out.includes('data-testid="chats-beside"') && out.includes("CONVERSATION"));
  assert.ok(!out.includes('data-testid="chats-drawer-toggle"'));
  assert.ok(out.includes('aria-label="The run"'));
});

test("narrow: the workspace is kept, and the conversation is a drawer with one toggle", () => {
  const out = html(true, "run");
  assert.ok(out.includes('data-testid="chats-work"') && out.includes('data-testid="chats-drawer-toggle"') && out.includes("CONVERSATION"));
  assert.ok(out.includes("Hide conversation"));
});
