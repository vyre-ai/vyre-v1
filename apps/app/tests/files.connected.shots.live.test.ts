// Pictures of the connected bar in the real app, light and dark: the line that says whose connection a save goes out under, a change that has not reached Drive, a file deleted there while an edit waits
// (Keep it here, Discard my changes), and a change made there too (Keep both, Use theirs). The app, the viewer and the bar are the real ones against a real daemon; what the daemon would say about a
// provider is put into the viewer's own answer (files.viewer_data) on the way, because a real provider is not reachable from a browser walk here. The booted-daemon proof that the daemon says these things
// is in test/viewers.drive.live.test.ts and test/mounts.drive.safety.live.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { session } from "./viewers-harness.test.ts";

type Connected = Record<string, unknown>;
const STATES: Array<[string, Connected, string]> = [
  ["writes-as", { provider: "Google Drive", writesAs: { by: "usr_noah" } }, "file-connected-writesas"],
  [
    "not-sent",
    {
      provider: "Google Drive",
      notSent: { reason: "Google Drive did not accept the change: you no longer have edit access there." },
    },
    "file-connected-notsent",
  ],
  [
    "gone-there",
    {
      provider: "Google Drive",
      notSent: {
        reason: "This file was deleted at Google Drive while your change was waiting. Your change is kept here.",
        goneThere: true,
      },
    },
    "file-connected-gone",
  ],
  [
    "changed-there",
    { provider: "Google Drive", changedThere: { by: { name: "Kim Ito" }, at: Date.now() - 600_000 } },
    "file-connected-changed",
  ],
];

test("the connected bar's lines in the real app, in both skins", async (t) => {
  const s = await session(t, { width: 1280, height: 800 });
  if (!s) return;
  const { page } = s;
  try {
    // one file for each line: the app keeps what it read about a file, so a file keeps one answer
    const ids = new Map<string, Connected>();
    const idOf: Record<string, string> = {};
    for (const [name, connected] of STATES) {
      const f = await s.make(`${name}.txt`, Buffer.from("The first words of the plan.\nA second line."), "text/plain");
      idOf[name] = f.file.fileId as string;
      ids.set(f.file.fileId as string, connected);
    }
    await page.route("**/v1/files/viewer_data", async (route) => {
      const res = await route.fetch();
      const json = (await res.json()) as { data?: Record<string, unknown> };
      const asked = (route.request().postDataJSON() as { fileId?: string } | null)?.fileId ?? "";
      const c = ids.get(asked);
      if (json.data && c !== undefined) json.data["connected"] = c;
      await route.fulfill({ response: res, json });
    });
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const [name, , testId] of STATES) {
        await page.goto(`${s.web.origin}/files#subject=file:${idOf[name]}`, { waitUntil: "load" });
        try {
          await page.getByTestId(testId).waitFor({ timeout: 25_000 });
        } catch (e) {
          console.log(
            "DEBUG",
            name,
            JSON.stringify((await page.evaluate(() => document.body.innerText)).slice(0, 300)),
          );
          throw e;
        }
        const line = await page.getByTestId(testId).innerText();
        if (name === "gone-there") {
          assert.match(line, /Keep it here/);
          assert.match(line, /Discard my changes/);
        }
        if (name === "changed-there") {
          assert.match(line, /Keep both/);
          assert.match(line, /Use theirs/);
        }
        await page.screenshot({
          path: `${process.env["VYRE_VIEWER_SHOTS"] ?? "/tmp/vyre-viewer-shots"}/owner-connected-${scheme}-${name}.png`,
        });
      }
    }
  } finally {
    await s.close();
  }
});
