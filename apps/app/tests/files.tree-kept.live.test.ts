// The Files sidebar is made again each time a person comes back to Files from another place; what they folded and opened in it stays as they left it
// (places/files/tree/kept.ts). Real browser, real daemon: fold the Space section, go to Chats, come back, and it is still folded; open it, go and come back, still open.
import test from "node:test";
import assert from "node:assert/strict";
import { session } from "./viewers-harness.test.ts";

test("a section folded in the Files sidebar is still folded after going to Chats and back, and an open one is still open", async (t) => {
  const s = await session(t);
  if (!s) return;
  const { page, web } = s;
  const rail = (name: string) =>
    page
      .getByTestId(`rail-${name}`)
      .or(page.getByTestId(`rail-${name}-selected`))
      .first();
  const head = () => page.getByTestId("files-head-space");
  const allFiles = () => page.getByTestId("files-tree").getByText("All files", { exact: true });
  const awayAndBack = async (): Promise<void> => {
    await rail("chats").click();
    await page.getByTestId("files-tree").waitFor({ state: "detached", timeout: 15_000 });
    await rail("files").click();
    await head().waitFor({ timeout: 20_000 });
  };
  try {
    await page.goto(`${web.origin}/files`, { waitUntil: "load" });
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    await head().waitFor({ timeout: 20_000 });
    await allFiles().first().waitFor({ timeout: 10_000 });
    assert.match((await head().getAttribute("aria-label")) ?? "", /, open$/, "the Space section starts open");

    await head().click();
    await allFiles().first().waitFor({ state: "detached", timeout: 10_000 });
    await awayAndBack();
    assert.match((await head().getAttribute("aria-label")) ?? "", /, closed$/, "the fold is kept");
    assert.equal(await allFiles().count(), 0, "and its rows stay hidden");
    await s.shot("files-tree-kept-folded");

    await head().click();
    await allFiles().first().waitFor({ timeout: 10_000 });
    await awayAndBack();
    assert.match((await head().getAttribute("aria-label")) ?? "", /, open$/, "opened again, it comes back open");
    await allFiles().first().waitFor({ timeout: 10_000 });
    assert.deepEqual(s.errors, []);
  } finally {
    await s.close();
  }
});
