// The assistant is the Vyre mark unless a look is set; every other agent's face comes from its id; a person keeps their own.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { Avatar, avatarOf, resetAssistant, setAssistantId, setAssistantLook } from "./index.tsx";

const html = (p: Parameters<typeof Avatar>[0]): string => renderToStaticMarkup(<Avatar {...p} />);

test("the assistant is the Vyre mark by id, even after a rename", () => {
  resetAssistant(); setAssistantId("agt_a");
  for (const name of ["Assistant", "Irfad Assistant", "Irfad’s Assistant"]) {
    const h = html({ ...avatarOf({ id: "agt_a", name, kind: "agent" }), size: 20 });
    assert.match(h, /data-avatar="assistant"/, name);
    assert.match(h, /class="vmark"/, name);
  }
});

test("an agent keeps one face by id across renames; another id draws another face", () => {
  resetAssistant(); setAssistantId("agt_a");
  const a = avatarOf({ id: "agt_scout", name: "Scout", kind: "agent" });
  const b = avatarOf({ id: "agt_scout", name: "Scout Prime", kind: "agent" });
  assert.equal(a.kind, "agent");
  assert.equal(a.seedId, b.seedId);
  assert.match(html({ ...a, size: 20 }), /data-avatar="agent"/);
  assert.notEqual(avatarOf({ id: "agt_other", name: "Scout", kind: "agent" }).seedId, a.seedId);
});

test("a person keeps their own avatar and photo", () => {
  resetAssistant(); setAssistantId("agt_a");
  const p = avatarOf({ id: "usr_1", name: "Maya Chen", kind: "person", photo: "https://x.test/m.png" });
  assert.equal(p.kind, "person");
  assert.match(html({ ...p, size: 20 }), /m\.png/);
  assert.match(html({ ...avatarOf({ id: "usr_2", name: "Omar" }), size: 20 }), /data-avatar="person"/);
});

test("a look set in Settings replaces the mark, and clearing it brings the mark back", () => {
  resetAssistant(); setAssistantId("agt_a");
  setAssistantLook("look-tide");
  const looked = html({ ...avatarOf({ id: "agt_a", name: "Irfad’s Assistant", kind: "agent" }), size: 20 });
  assert.doesNotMatch(looked, /class="vmark"/);
  setAssistantLook(null);
  assert.match(html({ ...avatarOf({ id: "agt_a", name: "Irfad’s Assistant", kind: "agent" }), size: 20 }), /class="vmark"/);
});
