// The connect sheet, one app at a time (lane r42-mcp): pick an app, see its steps and what to copy, go back, pick another; a refused address shows its words; nothing dead-ends.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { installDom, find, flush, press } from "../../../ui/src/testing/dom.ts";
import { ConnectOutsideAgent } from "../src/places/chats/mounts/ConnectOutsideAgent.tsx";

const LINK = { url: "https://northwind.vyre.run/mcp", claudeCode: "claude mcp add --transport http vyre https://northwind.vyre.run/mcp" };
type R = ReturnType<typeof createRoot>;
const root = (r: R) => r.container as unknown as Parameters<typeof find>[0];
const text = (n: unknown): string => JSON.stringify(n);

async function open(call: (cap: string, input: unknown) => Promise<unknown>): Promise<{ r: R; closed: () => number }> {
  let closed = 0;
  const r = createRoot();
  await act(async () => {
    r.render(<ConnectOutsideAgent call={call} onClose={() => void (closed += 1)} />);
  });
  await flush();
  return { r, closed: () => closed };
}

test("the sheet opens on the apps, each app shows its own steps and copy lines, Back returns, and every app can be reached", async () => {
  const restore = installDom();
  try {
    const { r } = await open(async () => LINK);
    for (const [id, testID] of [
      ["claude", "connect-link"],
      ["chatgpt", "connect-link"],
      ["cursor", "connect-open-app"],
      ["code", "connect-claude"],
      ["other", "connect-link"],
    ] as const) {
      assert.ok(find(root(r), "connect-pick"), `the apps are shown before ${id}`);
      await press(find(root(r), `connect-app-${id}`));
      await flush();
      assert.ok(find(root(r), testID), `${id} shows ${testID}`);
      assert.ok(find(root(r), "connect-step-1"), `${id} says what to do first`);
      assert.equal(find(root(r), "connect-pick"), null, "the apps are not shown at the same time");
      await press(find(root(r), "connect-back"));
      await flush();
    }
    assert.ok(find(root(r), "connect-pick"), "back at the apps");
  } finally {
    restore();
  }
});

test("a refused address says why and leaves Done working; Done closes", async () => {
  const restore = installDom();
  try {
    const { r, closed } = await open(async () => {
      throw { error: { message: "This Space has no address yet." } };
    });
    assert.ok(find(root(r), "connect-problem"), "the problem is shown");
    assert.equal(find(root(r), "connect-pick"), null);
    await press(find(root(r), "connect-done"));
    assert.equal(closed(), 1);
    assert.ok(text(find(root(r), "connect-problem")).length > 0);
  } finally {
    restore();
  }
});
