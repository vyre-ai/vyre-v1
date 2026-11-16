// A file dragged out of a connected folder, or into one, asks first (16 Nov 2026): Move it (or Upload it), Keep a copy there, Cancel. The same sheet in the list and in the tree. A real provider is not reachable from a
// browser walk, so the folder "Viewers" and the file "a.txt" in it are given a Google Drive source on the way (what the daemon says about a mount is proved in test/mounts.drive.safety.live.test.ts); every move,
// copy and refusal is the real daemon's. Pictures go to VYRE_VIEWER_SHOTS.
import test from "node:test";
import assert from "node:assert/strict";
import type { Locator, Page } from "playwright-core";
import { session } from "./viewers-harness.test.ts";

const SRC = { mountId: "mnt_walk", provider: "google_drive" };

async function mountLook(page: Page): Promise<void> {
  const patch = async (route: import("playwright-core").Route, fix: (d: any) => void): Promise<void> => {
    const res = await route.fetch();
    const json = (await res.json()) as { data?: any };
    if (json.data) fix(json.data);
    await route.fulfill({ response: res, json });
  };
  await page.route("**/v1/files/list", (r) =>
    patch(r, (d) => {
      for (const f of d.files ?? []) if (f.name === "a.txt") f.source = SRC;
      for (const f of d.folders ?? []) if (f.name === "Viewers") f.source = SRC;
    }),
  );
  await page.route("**/v1/files/get", (r) =>
    patch(r, (d) => {
      if (d.file?.name === "a.txt") d.file.source = SRC;
    }),
  );
}

/** A drag as the browser makes it: dragstart on the item (it writes what is dragged), dragover and drop on the target, one DataTransfer through all three. */
async function drag(from: Locator, to: Locator): Promise<void> {
  const target = await to.elementHandle();
  assert.ok(target, "a drop target");
  await from.evaluate((src: HTMLElement, dst: HTMLElement) => {
    const dataTransfer = new DataTransfer();
    const fire = (el: HTMLElement, type: string): void => {
      el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, composed: true, dataTransfer }));
    };
    fire(src, "dragstart");
    fire(dst, "dragenter");
    fire(dst, "dragover");
    fire(dst, "drop");
    fire(src, "dragend");
  }, target);
}

async function setup(s: NonNullable<Awaited<ReturnType<typeof session>>>) {
  const root = JSON.stringify(await s.call("files.tree", {})).match(/"(fld_[a-z0-9]+)"/)![1]!;
  const sandbox = (await s.call("files.folder.create", { parentId: root, name: "Sandbox", idempotencyKey: "ma-sb" }))
    .folder.folderId as string;
  const inner = (
    await s.call("files.folder.create", { parentId: s.folderId, name: "Inner", idempotencyKey: "ma-inner" })
  ).folder.folderId as string;
  const a = (await s.make("a.txt", Buffer.from("Words from the drive."), "text/plain")).file.fileId as string;
  const local = (
    await s.call("files.create", {
      folderId: root,
      name: "local.txt",
      content: { base64: Buffer.from("Words kept here.").toString("base64") },
      mime: "text/plain",
      idempotencyKey: "ma-local",
    })
  ).file.fileId as string;
  await mountLook(s.page);
  return { root, sandbox, inner, a, local };
}

const where = async (s: NonNullable<Awaited<ReturnType<typeof session>>>, fileId: string): Promise<string> =>
  (await s.call("files.get", { fileId })).file.folderId as string;

for (const [label, size, scheme] of [
  ["dark desktop", { width: 1440, height: 900 }, "dark"],
  ["light phone", { width: 390, height: 844 }, "light"],
] as const) {
  const tag = scheme === "dark" ? "desktop" : "phone";
  test(`in the list, a drop into or out of a connected folder asks first (${label})`, async (t) => {
    const s = await session(t, size, scheme);
    if (!s) return;
    const { page } = s;
    try {
      const { root, inner, a, local } = await setup(s);
      await page.goto(`${s.web.origin}/files#subject=folder:${root}`, { waitUntil: "load" });
      const item = (key: string): Locator => page.locator(`[data-fkey="${key}"]`).first();
      await item(`file:${local}`).waitFor({ timeout: 30_000 });
      // into: the file goes up to Google Drive
      await drag(item(`file:${local}`), item(`folder:${s.folderId}`));
      await page.getByTestId("move-ask").waitFor({ timeout: 10_000 });
      assert.match(await page.getByTestId("move-ask-text").innerText(), /local\.txt.*uploaded to Google Drive/);
      assert.equal(await page.getByTestId("move-ask-copy").count(), 0, "no copy offered for an upload");
      await s.shot(`moveask-list-in-${tag}`);
      await page.getByTestId("move-ask-cancel").click();
      await page.getByTestId("move-ask").waitFor({ state: "detached", timeout: 5_000 });
      assert.equal(await where(s, local), root, "Cancel moves nothing");
      await drag(item(`file:${local}`), item(`folder:${s.folderId}`));
      await page.getByTestId("move-ask-move").click();
      await page.getByTestId("move-ask").waitFor({ state: "detached", timeout: 5_000 });
      for (let i = 0; i < 40 && (await where(s, local)) !== s.folderId; i++) await page.waitForTimeout(150);
      assert.equal(await where(s, local), s.folderId, "Upload it moves the file in");
      // out: the file leaves Google Drive; Keep a copy leaves the original there
      await page.goto(`${s.web.origin}/files#subject=folder:${s.folderId}`, { waitUntil: "load" });
      await item(`file:${a}`).waitFor({ timeout: 30_000 });
      await drag(item(`file:${a}`), item(`folder:${inner}`));
      await page.getByTestId("move-ask").waitFor({ timeout: 10_000 });
      assert.match(await page.getByTestId("move-ask-text").innerText(), /remove it from Google Drive/);
      await s.shot(`moveask-list-out-${tag}`);
      await page.getByTestId("move-ask-copy").click();
      await page.getByTestId("move-ask").waitFor({ state: "detached", timeout: 5_000 });
      let copied = 0;
      for (let i = 0; i < 40 && copied === 0; i++) {
        copied = ((await s.call("files.list", { folder: inner })).files as unknown[]).length;
        if (copied === 0) await page.waitForTimeout(150);
      }
      assert.equal(copied, 1, "Keep a copy puts a copy in the folder");
      assert.equal(await where(s, a), s.folderId, "and the original stays");
    } finally {
      await s.close();
    }
  });
}

test("in the tree, a drop onto a connected folder, or from one onto a local folder, asks first, in the same sheet", async (t) => {
  const s = await session(t, { width: 1440, height: 900 }, "dark");
  if (!s) return;
  const { page } = s;
  try {
    const { root, inner, a, local } = await setup(s);
    await page.goto(`${s.web.origin}/files#subject=folder:${root}`, { waitUntil: "load" });
    const item = (key: string): Locator => page.locator(`[data-fkey="${key}"]`).first();
    const tree = page.getByTestId("files-tree");
    await item(`file:${local}`).waitFor({ timeout: 30_000 });
    await tree.getByText("Viewers", { exact: true }).first().waitFor({ timeout: 20_000 });
    await drag(item(`file:${local}`), tree.getByText("Viewers", { exact: true }).first());
    await page.getByTestId("move-ask").waitFor({ timeout: 10_000 });
    assert.equal(await page.getByTestId("files-tree").getByTestId("move-ask").count(), 1, "the sheet is in the tree");
    assert.match(await page.getByTestId("move-ask-text").innerText(), /local\.txt.*uploaded to Google Drive/);
    await s.shot("moveask-tree-in-desktop");
    await page.getByTestId("move-ask-cancel").click();
    assert.equal(await where(s, local), root, "Cancel moves nothing");
    await page.goto(`${s.web.origin}/files#subject=folder:${s.folderId}`, { waitUntil: "load" });
    await item(`file:${a}`).waitFor({ timeout: 30_000 });
    await tree.getByTestId(`folder-toggle-${s.folderId}`).click({ timeout: 20_000 });
    await tree.getByText("Inner", { exact: true }).first().waitFor({ timeout: 20_000 });
    await drag(item(`file:${a}`), tree.getByText("Inner", { exact: true }).first());
    await page.getByTestId("move-ask").waitFor({ timeout: 10_000 });
    assert.match(await page.getByTestId("move-ask-text").innerText(), /remove it from Google Drive/);
    await s.shot("moveask-tree-out-desktop");
    await page.getByTestId("move-ask-move").click();
    for (let i = 0; i < 40 && (await where(s, a)) !== inner; i++) await page.waitForTimeout(150);
    assert.equal(await where(s, a), inner, "Move it takes the file out of the connected folder");
  } finally {
    await s.close();
  }
});
