import test from "node:test";
import assert from "node:assert/strict";
import { PLACES, indexMd, rowFor } from "./real-app.mjs";
import { todoFor } from "../../apps/app/tests/real-app-harness.ts";

test("real-app shots: Home, Chats, Records and Files are shot, each with the steps whose modules it needs", () => {
  assert.deepEqual(PLACES.map((p) => p.id), ["home", "chats", "records", "files"]);
  for (const p of PLACES) for (const step of p.needs) assert.equal(typeof todoFor(step, new Set()), "string", `${p.id}: ${step} is a known step`);
});

test("real-app shots: a row says whether the place drew and which stub modules it waits on; the index never calls a stub a finished screen", () => {
  const vp = { width: 390, height: 844 };
  const waiting = rowFor({ place: "chats", skin: "paper", sizeName: "phone", vp, file: "paper-phone.png", drew: false, gaps: ["chats: chat still a stub in host/modules.json (live with P-L2_LIVE)"] });
  assert.match(waiting, /place did not draw \| chats: chat still a stub/);
  assert.match(waiting, /P-APP_03-real-chats\/paper-phone\.png/);
  assert.match(rowFor({ place: "home", skin: "graphite", sizeName: "desktop", vp: { width: 1280, height: 800 }, file: "graphite-desktop.png", drew: true, gaps: [] }), /place drew \| all modules live/);
  const md = indexMd([waiting]);
  assert.match(md, /not a finished screen/);
  assert.match(md, /\| place \| skin \| size \| image \| result \| modules \|/);
});
