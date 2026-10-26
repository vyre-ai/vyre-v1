// P-UI_16: one face per person everywhere. The same id draws the same face in the share sheet, a Plan assignee and the shared Avatar, whatever name each place has for the person;
// with no id the name seeds the face as before.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { Avatar, marbleInner } from "../Avatar/index.tsx";
import { Face } from "../Plan/parts.tsx";
import { ShareSheet, frozenShareSheetProps } from "./index.tsx";

test("the owner's face in the share sheet and a Plan assignee are the face the id seeds, not the one the name seeds", () => {
  const share = renderToStaticMarkup(<ShareSheet {...frozenShareSheetProps} ownerName="Maya C." ownerId="usr_maya" />);
  const plan = renderToStaticMarkup(<Face who={{ name: "Maya Chen", kind: "person", id: "usr_maya" }} size={20} />);
  const plain = renderToStaticMarkup(<Avatar name="Maya Chen" seedId="usr_maya" size={20} />);
  for (const html of [share, plan, plain]) {
    assert.ok(html.includes(marbleInner("usr_maya")), "the marble the id seeds");
  }
  assert.ok(!plan.includes(marbleInner("Maya Chen")) && !share.includes(marbleInner("Maya C.")), "not the name's marble");
});

test("a share row is seeded by its subject id, and a place with no id keeps the name's face", () => {
  const share = renderToStaticMarkup(<ShareSheet {...frozenShareSheetProps} />);
  assert.ok(share.includes(marbleInner("prs_omar")), "the row's subject id seeds Omar's face");
  const plan = renderToStaticMarkup(<Face who={{ name: "Maya Chen", kind: "person" }} size={20} />);
  assert.ok(plan.includes(marbleInner("Maya Chen")), "no id: the name seeds it as before");
});
