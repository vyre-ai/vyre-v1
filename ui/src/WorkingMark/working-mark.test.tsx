import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { WORKING_MARK_CSS, WorkingMark } from "./index.tsx";

test("the mark is the Vyre V with its dot, in ink, and its state is a class: thinking, writing with a light on the V, done, still", () => {
  const think = renderToStaticMarkup(<WorkingMark state="thinking" />);
  assert.match(think, /vyre-wm-thinking/);
  assert.match(think, /M5\.2 6\.4l6\.3 11\.2 4\.9-8\.6/);
  assert.match(think, /stroke="currentColor"/, "ink is currentColor, so both themes work");
  assert.match(think, /cx="18\.6" cy="5\.6" r="2\.7"/);
  assert.ok(!think.includes("vyre-wm-light"), "no light while it only thinks");
  assert.match(renderToStaticMarkup(<WorkingMark state="writing" />), /vyre-wm-light/);
  assert.match(renderToStaticMarkup(<WorkingMark state="done" />), /vyre-wm-done/);
  assert.match(renderToStaticMarkup(<WorkingMark state="still" />), /vyre-wm-still/);
});

test("a step is one nod on a dot group that is the same element for the life of the mark: no key, no remount, no CSS class animation to restart", () => {
  const a = renderToStaticMarkup(<WorkingMark state="thinking" step="t1l" />);
  const b = renderToStaticMarkup(<WorkingMark state="thinking" step="t2l" />);
  assert.equal(a, b, "the markup does not depend on the step");
  assert.ok(!a.includes("vyre-wm-step"));
});

test("the motion is CSS only, honours reduced motion, and sets no per-frame work", () => {
  assert.match(WORKING_MARK_CSS, /@media \(prefers-reduced-motion:reduce\)/);
  assert.match(WORKING_MARK_CSS, /2\.4s ease-in-out infinite/);
  assert.ok(!/vyre-wm-nod/.test(WORKING_MARK_CSS), "the nod is a Web Animation, so it fires no animationstart");
  assert.match(WORKING_MARK_CSS, /1\.8s ease-in-out infinite alternate/);
  assert.ok(!/requestAnimationFrame|setInterval/.test(WORKING_MARK_CSS));
});
