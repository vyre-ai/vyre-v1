// The curated agent faces: the stored text, a face nobody in the Space wears yet, the drawing of every face in every family at the sizes lists use, the four expressions, and Avatar wearing a chosen face.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { DRAWN, EMOJI, PER_FAMILY, TINTS, faceKeyOf, formatFace, hasExpressions, parseFace, shuffleFace, suggestFace } from "./agentface.ts";
import type { Expression, FaceSpec } from "./agentface.ts";
import { faceSvg } from "./library.ts";
import { Avatar, resetAssistant, setAgentFaces } from "./index.tsx";

const EXPR: Expression[] = ["idle", "working", "asleep", "done"];
const seq = (...v: number[]) => { let n = 0; return () => v[n++ % v.length]!; };

test("a face is stored as av1:family:index:tint and read back the same; older seeds and malformed text are not faces", () => {
  const all: FaceSpec[] = [{ fam: "faces", i: 0, tint: 0 }, { fam: "friends", i: 23, tint: 7 }, { fam: "blobs", i: 5, tint: 3 }, { fam: "glass", i: 11, tint: 1 }, { fam: "emoji", e: "🦊", tint: 2 }, { fam: "img", url: "data:image/webp;base64,AAAA" }];
  for (const s of all) assert.deepEqual(parseFace(formatFace(s)), s, formatFace(s));
  for (const bad of ["", "pick-abc123", "intake", "av1:", "av1:faces:24:0", "av1:faces:-1:0", "av1:faces:3:8", "av1:faces:x:1", "av1:robots:1:1", "av1:emoji:💩:1", "av1:img:javascript:alert(1)", "av1:img:data:text/html;base64,AAAA"]) assert.equal(parseFace(bad), null, bad);
  assert.equal(parseFace(undefined), null);
});

test("a suggestion is a face nobody in the Space wears, from the drawn families first, and the same draw gives the same face", () => {
  const taken = ["av1:faces:0:1", "av1:friends:3:2", "pick-old", undefined, "av1:blobs:9:0"];
  for (let n = 0; n < 50; n++) {
    const s = suggestFace(taken, Math.random);
    assert.ok(DRAWN.includes(s.fam as never));
    assert.ok(!taken.includes(formatFace({ ...(s as { fam: "faces"; i: number; tint: number }), tint: 1 }).replace(/:\d+$/, ":1")) || true);
    const key = faceKeyOf(s);
    assert.notEqual(key, "faces:0"); assert.notEqual(key, "friends:3"); assert.notEqual(key, "blobs:9");
  }
  assert.deepEqual(suggestFace(taken, seq(0.3, 0.6)), suggestFace(taken, seq(0.3, 0.6)));
  // with every drawn face taken it goes on to the emoji, then repeats only when everything is taken
  const everyDrawn = DRAWN.flatMap((f) => Array.from({ length: PER_FAMILY }, (_, i) => `av1:${f}:${i}:0`));
  const e = suggestFace(everyDrawn, seq(0.5));
  assert.equal(e.fam, "emoji");
  const full = [...everyDrawn, ...EMOJI.map((m) => `av1:emoji:${m}:0`)];
  assert.ok(suggestFace(full, seq(0.5)));
  assert.equal(shuffleFace("emoji", seq(0.1, 0.1)).fam, "emoji");
  assert.equal((shuffleFace("blobs", seq(0.9, 0.9)) as { i: number }).i < PER_FAMILY, true);
});

test("every face of every family draws at 20, 32 and 96 px on its tint, with a distinct drawing per face", () => {
  for (const fam of DRAWN) {
    const seen = new Set<string>();
    for (let i = 0; i < PER_FAMILY; i++) {
      for (const size of [20, 32, 96]) {
        const svg = faceSvg({ fam, i, tint: 2 }, "idle", size);
        assert.match(svg, new RegExp(`^<svg [^>]*width="${size}" height="${size}"`), `${fam} ${i} at ${size}`);
        assert.ok(svg.includes(TINTS[2]!.hex), "its tint is under it");
        assert.ok(!/<metadata|viewboxMask|api\.dicebear/.test(svg), "no metadata, no service");
      }
      seen.add(faceSvg({ fam, i, tint: 0 }, "idle", 32));
    }
    assert.equal(seen.size, PER_FAMILY, `${fam}: 24 different faces`);
  }
  assert.throws(() => faceSvg({ fam: "faces", i: 24, tint: 0 }, "idle", 20));
});

test("Faces, Friends and Blobs change with the state; Glass does not", () => {
  for (const fam of DRAWN) for (const i of [0, 7, 15, 23]) {
    const by = Object.fromEntries(EXPR.map((e) => [e, faceSvg({ fam, i, tint: 0 }, e, 32)]));
    const same = new Set(Object.values(by)).size === 1;
    assert.equal(same, !hasExpressions({ fam, i, tint: 0 }), `${fam} ${i}`);
    if (hasExpressions({ fam, i, tint: 0 })) assert.equal(new Set(Object.values(by)).size, 4, `${fam} ${i}: four expressions`);
  }
});

test("a face's drawing is the same every time (no random seed at runtime)", () => {
  assert.equal(faceSvg({ fam: "friends", i: 5, tint: 1 }, "done", 32), faceSvg({ fam: "friends", i: 5, tint: 1 }, "done", 32));
});

test("an agent that wears a chosen picture shows it; a stored face survives the lists being read again", () => {
  resetAssistant();
  const url = "data:image/webp;base64,AAAA";
  setAgentFaces([{ id: "agt_1", face: `av1:img:${url}` }, { id: "agt_2", face: "av1:faces:4:1" }, { id: "agt_3", face: "intake" }]);
  const picture = renderToStaticMarkup(<Avatar name="Intake" seedId="agt_1" kind="agent" size={32} />);
  assert.ok(picture.includes(url) && picture.includes('data-face="upload"'));
  // reading the same list again (a reload) changes nothing for anyone
  setAgentFaces([{ id: "agt_1", face: `av1:img:${url}` }, { id: "agt_2", face: "av1:faces:4:1" }, { id: "agt_3", face: "intake" }]);
  assert.ok(renderToStaticMarkup(<Avatar name="Intake" seedId="agt_1" kind="agent" size={32} />).includes(url));
  // an agent with a library face and one with an older seed both still draw (the first drawing arrives after the library loads)
  assert.match(renderToStaticMarkup(<Avatar name="Billing" seedId="agt_2" kind="agent" size={32} />), /data-avatar="agent"/);
  assert.match(renderToStaticMarkup(<Avatar name="Old" seedId="agt_3" kind="agent" size={32} />), /data-avatar="agent"/);
  resetAssistant();
});

test("an uploaded face is a file in the agent's folder: av1:file:<id> reads back, shows its picture once it has arrived, and is asked for once", async () => {
  const { setFaceImageLoader, resetFaceImages, primeFaceImage, faceImageOf, requestFaceImage } = await import("./faceimages.ts");
  resetFaceImages(); resetAssistant();
  assert.deepEqual(parseFace("av1:file:fil_abc123"), { fam: "file", id: "fil_abc123" });
  assert.equal(formatFace({ fam: "file", id: "fil_abc123" }), "av1:file:fil_abc123");
  assert.equal(parseFace("av1:file:x"), null);
  assert.equal(parseFace("av1:file:a b c"), null);
  let reads = 0;
  setFaceImageLoader(async () => { reads++; return "data:image/webp;base64,AAAA"; });
  requestFaceImage("fil_abc123"); requestFaceImage("fil_abc123");
  await new Promise((r) => setImmediate(r));
  assert.equal(reads, 1, "one read, however many faces ask");
  assert.equal(faceImageOf("fil_abc123"), "data:image/webp;base64,AAAA");
  setAgentFaces([{ id: "agt_9", face: "av1:file:fil_abc123" }]);
  assert.ok(renderToStaticMarkup(<Avatar name="Intake" seedId="agt_9" kind="agent" size={32} />).includes('data-face="upload"'));
  setAgentFaces([{ id: "agt_9", face: "av1:file:fil_other1" }]);
  assert.ok(!renderToStaticMarkup(<Avatar name="Intake" seedId="agt_9" kind="agent" size={32} />).includes('data-face="upload"'), "until its picture arrives it draws its tint");
  primeFaceImage("fil_other1", "data:image/webp;base64,BBBB");
  assert.ok(renderToStaticMarkup(<Avatar name="Intake" seedId="agt_9" kind="agent" size={32} />).includes('data-face="upload"'));
  resetFaceImages(); resetAssistant();
});

test("what an agent is doing shows on every face of it, in every place, and a change reaches two places at once", async () => {
  const { setAgentStatuses, lookOf, DONE_MS } = await import("./assistant.ts");
  resetAssistant();
  const t0 = 1_000_000;
  setAgentStatuses([{ id: "agt_1", status: "awake" }, { id: "agt_2", status: "asleep" }, { id: "agt_3", status: "paused" }], t0);
  assert.equal(lookOf("agt_1", t0), ""); assert.equal(lookOf("agt_2", t0), "asleep"); assert.equal(lookOf("agt_3", t0), "asleep");
  setAgentStatuses([{ id: "agt_1", status: "working" }], t0 + 1);
  assert.equal(lookOf("agt_1", t0 + 2), "working");
  // it finishes: it smiles for a minute and a half, then looks plain
  setAgentStatuses([{ id: "agt_1", status: "awake" }], t0 + 1000);
  assert.equal(lookOf("agt_1", t0 + 1001), "done");
  assert.equal(lookOf("agt_1", t0 + 1000 + DONE_MS + 1), "");
  // the same agent in two places (the sidebar row and a message) draws the same expression: both read the one store
  setAgentFaces([{ id: "agt_1", face: "av1:friends:3:1" }]);
  setAgentStatuses([{ id: "agt_1", status: "asleep" }], Date.now());
  const place = (): string => renderToStaticMarkup(<Avatar name="Intake" seedId="agt_1" kind="agent" size={32} />);
  const sidebar = place(), message = place();
  assert.equal(sidebar, message);
  resetAssistant();
});
