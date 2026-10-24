// Screen test for frozen props batch 3. Loaded by scripts/test-run.mjs via node --test.

import test from "node:test";
import assert from "node:assert/strict";
import { renderScreen, softphoneSample, terminalSample, emailSample, viewerSample, viewerScreen } from "./index.tsx";
import { renderBlock, NATIVE_BLOCK_TYPES, blockRenderers, sampleNativeBlocks, unknownBlockSample } from "../blocks/registry.ts";
import { EMAIL_BLOCK_KINDS, EMAIL_PREVIEWS } from "../EmailBuilder/props.ts";
import { TerminalPlaceholder } from "../Terminal/Placeholder.tsx";
import { isKitScreen } from "../kit/types.ts";

test("screen page renders every frozen component from its props", () => {
  const html = renderScreen();
  const caller = softphoneSample.caller?.name ?? "";
  assert.equal(html.includes('data-placeholder="Softphone"'), true);
  assert.equal(html.includes(`data-label="${caller}"`), true);
  assert.equal(caller, "Maya Chen");
  assert.equal(html.includes('data-placeholder="Terminal"'), true);
  assert.equal(html.includes(`data-label="${terminalSample.title}"`), true);
  assert.equal(html.includes('data-placeholder="EmailBuilder"'), true);
  assert.equal(html.includes(`data-label="${emailSample.subject}"`), true);
  assert.equal(html.includes('data-keys="Cmd-Shift-F"'), true);
  assert.equal(html.includes('data-preview="desktop"'), true);
  assert.equal(html.includes('data-preview-record="rec_maya"'), true);
  assert.equal(html.includes('data-kind="merge"'), true);
  assert.equal(EMAIL_BLOCK_KINDS.includes("columns"), true);
  assert.equal(EMAIL_BLOCK_KINDS.includes("merge"), true);
  assert.deepEqual([...EMAIL_PREVIEWS], ["desktop", "mobile", "dark"]);
  assert.equal(html.includes('data-placeholder="Viewer"'), true);
  assert.equal(html.includes(`data-label="${viewerSample.title}"`), true);
  assert.equal(html.includes('data-screen="batch3"'), true);
  assert.equal(html.includes('data-screen-id="files.viewer"'), true);
  assert.equal(html.includes('data-kit-screen="ok"'), true);
});

test("native registry covers fourteen types and the page renders each one", () => {
  const html = renderScreen();
  assert.equal(NATIVE_BLOCK_TYPES.length, 14);
  assert.equal(Object.keys(blockRenderers).length, 14);
  for (const type of NATIVE_BLOCK_TYPES) {
    assert.equal(typeof blockRenderers[`${type}@1`], "function", type);
    assert.equal(html.includes(`data-block-type="${type}"`), true, type);
  }
  assert.equal(html.includes('data-placeholder="GenericBlock"'), true);
});

test("an unknown type renders GenericBlock with collapsed data and copy trace id", () => {
  const html = renderBlock(unknownBlockSample);
  assert.equal(html.includes('data-placeholder="GenericBlock"'), true);
  assert.equal(html.includes('data-copy-trace="tr_comet"'), true);
  assert.equal(html.includes("Copy trace id"), true);
  assert.equal(html.includes("{&quot;n&quot;:1}"), true);
  assert.equal(html.includes('data-block-type="comet"'), false);
});

test("a newer version of a known type falls back to GenericBlock", () => {
  const html = renderBlock({
    type: "terminal",
    v: 2,
    id: "term-newer",
    data: { host: "Intake computer" },
    traceId: "tr_newer",
  });
  assert.equal(html.includes('data-placeholder="GenericBlock"'), true);
  assert.equal(html.includes("Ran commands on Intake computer"), true);
  assert.equal(html.includes('data-block-type="terminal"'), false);
});

test("a registered type at v 1 uses its own renderer", () => {
  let html = "";
  for (const block of sampleNativeBlocks()) {
    if (block.type === "terminal") html = renderBlock(block);
  }
  assert.equal(html.includes("GenericBlock"), false);
  assert.equal(html.includes('data-block-type="terminal"'), true);
  assert.equal(html.includes("Ran commands on Intake computer"), true);
});

test("a locked terminal asks for access and draws no prompt", () => {
  const html = TerminalPlaceholder({
    sessionId: "term_locked",
    title: "Server",
    host: "server",
    hostLabel: "Server",
    locked: true,
  });
  assert.equal(html.includes("Ask for access"), true);
  assert.equal(html.includes('data-locked="true"'), true);
  assert.equal(html.includes("<input"), false);
  assert.equal(html.includes("<pre"), false);
});

test("viewer screen matches KitScreenDef", () => {
  assert.equal(isKitScreen(viewerScreen), true);
  assert.equal(isKitScreen({ id: "x" }), false);
  assert.equal(viewerScreen.id, "files.viewer");
  assert.equal(viewerScreen.place, "files");
  assert.equal(viewerScreen.slot, "side");
});
