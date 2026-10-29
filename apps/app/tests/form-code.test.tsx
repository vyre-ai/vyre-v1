import test from "node:test";
import assert from "node:assert/strict";
import { Dimensions } from "react-native";
import { renderToStaticMarkup } from "react-dom/server";
import { FormCode, codeProblem } from "../src/places/apps/shell/FormCode.tsx";

const asked = [{ key: "email", title: "Email", type: "email" }, { key: "name", title: "Name", type: "text" }];
const render = (o: { html?: string; js?: string } = {}) => renderToStaticMarkup(<FormCode html={o.html ?? ""} css="" js={o.js ?? ""} onHtml={() => undefined} onCss={() => undefined} onJs={() => undefined} asked={asked} />);
Dimensions.set({ window: { width: 1280, height: 900, scale: 1, fontScale: 1 }, screen: { width: 1280, height: 900, scale: 1, fontScale: 1 } });

test("the Code tab edits HTML, CSS and JavaScript, offers Generate from Build, and says what is not placed", () => {
  const html = render();
  for (const label of ["HTML", "Custom CSS", "JavaScript"]) assert.ok(html.includes(`aria-label="${label}"`) || html.includes(`>${label}<`), label);
  assert.ok(html.includes("apps-code-generate"));
  assert.ok(!html.includes("apps-code-html-error"));
  const partial = render({ html: '<vyre-field name="email"></vyre-field>' });
  assert.ok(partial.includes("apps-code-unplaced") && partial.includes("Not placed in your HTML (shown after it): Name."));
  assert.ok(!render({ html: '<vyre-field name="email"></vyre-field><vyre-field name="name"></vyre-field>' }).includes("apps-code-unplaced"));
});

test("a refused source is shown with the line and reason, and Save is blocked on it", () => {
  const bad = render({ html: "<p>ok</p>\n<script>x()</script>" });
  assert.ok(bad.includes("apps-code-html-error") && bad.includes("line 2") && bad.includes("is not allowed"));
  assert.ok(render({ js: "a</script>b" }).includes("apps-code-js-error"));
  assert.equal(codeProblem("<p>ok</p>", "var a = 1;"), null);
  assert.match(codeProblem("<p onclick='x'>", "") ?? "", /^HTML: /);
  assert.match(codeProblem("", "<!-- x") ?? "", /^JavaScript: /);
  assert.equal(codeProblem("", ""), null);
});
