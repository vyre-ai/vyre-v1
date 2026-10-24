// Screen shots: batch1 and the screens page in Northwind and Harbor Studio (ARCH 10.1).

import test from "node:test";
import assert from "node:assert/strict";
import { COMPOSER_SYMBOLS, composerSymbols } from "../../ui/src/Composer/props.ts";
import { captureShot, type ProofBody, type ProofFetch, type ShotBrowser } from "./capture.ts";
import { batch1ComposerSample, renderScreenPage } from "./pages.ts";
import { pngFromText } from "./png.ts";
import { defaultDensity, DESKTOP_HEIGHT, DESKTOP_WIDTH, PHONE_HEIGHT, PHONE_WIDTH, placeSkin } from "./skins.ts";

const TRACKER = "http://tracker.test";
const PACKET = "P-PR_62";

interface Posted {
  url: string;
  init: { method: string; headers: Record<string, string>; body: string };
  proof: ProofBody;
  meta: {
    screenId: string;
    skin: string;
    skinId: string;
    space: string;
    density: string;
    width: number;
    height: number;
    runtime: string;
    html: string;
    pngBase64: string;
  };
}

function harness(): { browser: ShotBrowser; views: { width: number; height: number; html: string }[]; posts: Posted[]; fetchImpl: ProofFetch } {
  const views: { width: number; height: number; html: string }[] = [];
  const posts: Posted[] = [];
  const browser: ShotBrowser = {
    async newPage() {
      let width = 0;
      let height = 0;
      let html = "";
      return {
        async setViewportSize(size) {
          width = size.width;
          height = size.height;
        },
        async setContent(next) {
          html = next;
          views.push({ width, height, html: next });
        },
        async screenshot() {
          return pngFromText(html, width, height);
        },
        async close() {},
      };
    },
    async close() {},
  };
  const fetchImpl: ProofFetch = async (url, init) => {
    const proof = JSON.parse(init.body) as ProofBody;
    posts.push({ url, init, proof, meta: JSON.parse(proof.result) });
    return { ok: true, status: 201 };
  };
  return { browser, views, posts, fetchImpl };
}

test("place skins use system white for Northwind and linen for Harbor Studio", () => {
  const northwind = placeSkin("Northwind");
  const harbor = placeSkin("Harbor Studio");
  assert.equal(northwind.skinId, "system");
  assert.equal(northwind.space, "Northwind");
  assert.equal(northwind.tokens["--win"], "#FFFFFF");
  assert.equal(northwind.tokens["--accent"], "#5B50E8");
  assert.equal(harbor.skinId, "linen");
  assert.equal(harbor.space, "Harbor Studio");
  assert.equal(harbor.tokens["--win"], "#FAF7F2");
  assert.equal(harbor.tokens["--accent"], "#B45F3C");
  assert.equal(defaultDensity(PHONE_WIDTH), "compact");
  assert.equal(defaultDensity(DESKTOP_WIDTH), "regular");
  assert.throws(() => placeSkin("Graphite"), /Unknown skin/);
});

test("composer sample arguments are valid", () => {
  assert.equal(typeof batch1ComposerSample.whoWillAnswer, "string");
  assert.ok(batch1ComposerSample.whoWillAnswer.length > 0);
  assert.equal(batch1ComposerSample.sendsOutside, true);
  for (const chip of batch1ComposerSample.chips ?? []) {
    assert.equal(typeof chip.kind, "string");
    assert.equal(typeof chip.name, "string");
  }
  assert.deepEqual(composerSymbols(batch1ComposerSample), [...COMPOSER_SYMBOLS]);
});

test("unknown screen ids and unknown skins throw", async () => {
  await assert.rejects(() => renderScreenPage({ screenId: "missing", skin: "Northwind", width: PHONE_WIDTH }), /Unknown screen id/);
  await assert.rejects(() => renderScreenPage({ screenId: "batch1", skin: "Graphite", width: PHONE_WIDTH }), /Unknown skin/);
});

test("captures the batch1 screen page in Northwind and Harbor Studio skins", async () => {
  const { browser, views, posts, fetchImpl } = harness();
  for (const skin of ["Northwind", "Harbor Studio"]) {
    for (const width of [PHONE_WIDTH, DESKTOP_WIDTH]) {
      await captureShot({ packetId: PACKET, screenId: "batch1", skin, width, tracker: TRACKER, browser, fetchImpl });
    }
  }
  assert.equal(posts.length, 4);
  assert.equal(views.length, 4);
  const payloads = new Set(posts.map((post) => post.proof.result));
  assert.equal(payloads.size, 4);
  const skins = new Set(posts.map((post) => post.meta.skin));
  assert.deepEqual([...skins].sort(), ["Harbor Studio", "Northwind"]);
  for (const post of posts) {
    assert.equal(post.url, `${TRACKER}/api/packets/${PACKET}/proofs`);
    assert.equal(post.init.method, "POST");
    assert.equal(post.init.headers["content-type"], "application/json");
    assert.equal(post.proof.kind, "screenshot");
    assert.equal(post.meta.runtime, "react-native-web");
    assert.equal(post.meta.screenId, "batch1");
    assert.match(post.meta.html, /data-runtime="react-native-web"/);
    assert.match(post.meta.html, new RegExp(`data-width="${post.meta.width}"`));
    assert.match(post.meta.html, /data-placeholder="Composer"/);
    assert.match(post.meta.html, /data-placeholder="VirtualList"/);
    assert.match(post.meta.html, /data-placeholder="Menu"/);
    assert.match(post.meta.html, /data-placeholder="ListSections"/);
    assert.match(post.meta.html, /Ada will answer/);
    const png = Buffer.from(post.meta.pngBase64, "base64");
    assert.equal(png[0], 0x89);
    assert.equal(png.subarray(1, 4).toString("ascii"), "PNG");
    const view = views.find((row) => row.html === post.meta.html);
    assert.ok(view);
    assert.equal(view.width, post.meta.width);
    assert.equal(view.height, post.meta.height);
  }
  const north = posts.find((post) => post.meta.skin === "Northwind" && post.meta.width === PHONE_WIDTH);
  const harbor = posts.find((post) => post.meta.skin === "Harbor Studio" && post.meta.width === DESKTOP_WIDTH);
  assert.ok(north && harbor);
  assert.equal(north.meta.space, "Northwind");
  assert.equal(north.meta.skinId, "system");
  assert.equal(north.meta.density, "compact");
  assert.equal(north.meta.height, PHONE_HEIGHT);
  assert.match(north.meta.html, /data-space="Northwind"/);
  assert.match(north.meta.html, /data-skin-id="system"/);
  assert.match(north.meta.html, /data-density="compact"/);
  assert.match(north.meta.html, /--win:#FFFFFF/);
  assert.match(north.meta.html, /--accent:#5B50E8/);
  assert.equal(harbor.meta.space, "Harbor Studio");
  assert.equal(harbor.meta.skinId, "linen");
  assert.equal(harbor.meta.density, "regular");
  assert.equal(harbor.meta.height, DESKTOP_HEIGHT);
  assert.match(harbor.meta.html, /data-space="Harbor Studio"/);
  assert.match(harbor.meta.html, /data-skin-id="linen"/);
  assert.match(harbor.meta.html, /data-density="regular"/);
  assert.match(harbor.meta.html, /data-width="1280"/);
  assert.match(harbor.meta.html, /--win:#FAF7F2/);
  assert.match(harbor.meta.html, /--accent:#B45F3C/);
  assert.equal(north.proof.result === harbor.proof.result, false);
  assert.equal(north.meta.pngBase64 === harbor.meta.pngBase64, false);
});

test("screenshot of the screens page in both skins", async () => {
  const { browser, posts, fetchImpl } = harness();
  for (const skin of ["Northwind", "Harbor Studio"]) {
    for (const width of [PHONE_WIDTH, DESKTOP_WIDTH]) {
      await captureShot({ packetId: PACKET, screenId: "screens", skin, width, tracker: TRACKER, browser, fetchImpl });
    }
  }
  assert.equal(posts.length, 4);
  assert.equal(new Set(posts.map((post) => post.proof.result)).size, 4);
  for (const post of posts) {
    assert.equal(post.proof.kind, "screenshot");
    assert.match(post.proof.ref, /^screens-/);
    assert.match(post.meta.html, /data-runtime="react-native-web"/);
    assert.match(post.meta.html, /data-screen="batch3"/);
    assert.match(post.meta.html, /data-screen-id="files.viewer"/);
    assert.match(post.meta.html, /data-placeholder="Softphone"/);
    assert.match(post.meta.html, /data-placeholder="Viewer"/);
    assert.match(post.meta.html, new RegExp(`data-width="${post.meta.width}"`));
    assert.equal(post.meta.density, post.meta.width === PHONE_WIDTH ? "compact" : "regular");
  }
  const north = posts.find((post) => post.meta.skin === "Northwind");
  const harbor = posts.find((post) => post.meta.skin === "Harbor Studio");
  assert.ok(north && harbor);
  assert.match(north.meta.html, /data-skin-id="system"/);
  assert.match(north.meta.html, /--win:#FFFFFF/);
  assert.match(harbor.meta.html, /data-skin-id="linen"/);
  assert.match(harbor.meta.html, /data-space="Harbor Studio"/);
  assert.match(harbor.meta.html, /--win:#FAF7F2/);
});

test("an explicit density overrides the width default", async () => {
  const html = await renderScreenPage({ screenId: "batch1", skin: "Northwind", width: PHONE_WIDTH, density: "regular" });
  assert.match(html, /data-width="390"/);
  assert.match(html, /data-density="regular"/);
});
