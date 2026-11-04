// The look at start: an address that names a skin (?skin=graphite) wins for that view and is never saved; a person who never saved a look keeps the Space's skin; a saved By day / At night is used otherwise.
import test from "node:test";
import assert from "node:assert/strict";
import { explicitSkin, rememberLook, startupPlan } from "./settings-look.ts";
import { DEFAULT_LOOK } from "../../places/settings/look.ts";

const mem = new Map<string, string>();
(globalThis as Record<string, unknown>)["localStorage"] = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };

test("?skin= is read from the address", () => {
  assert.equal(explicitSkin("?skin=graphite"), "graphite");
  assert.equal(explicitSkin("?a=1&skin=paper"), "paper");
  assert.equal(explicitSkin(""), null);
  assert.equal(explicitSkin("?skin="), null);
});

test("no saved look: the skin is left to the Space and the device, with or without ?skin=", () => {
  mem.clear();
  assert.deepEqual(startupPlan("usr_a", ""), { look: null, paintSkin: false });
  assert.deepEqual(startupPlan("usr_a", "?skin=graphite"), { look: null, paintSkin: false });
});

test("a saved look paints its skin, except when the address names one (graphite, paper), and nothing is saved by the address", () => {
  mem.clear();
  const saved = { ...DEFAULT_LOOK, mode: "device" as const, day: "linen", night: "slate", rm: true };
  rememberLook("usr_a", saved);
  assert.equal(startupPlan("usr_a", "").paintSkin, true, "the By day / At night rule applies");
  for (const q of ["?skin=graphite", "?skin=paper"]) {
    const plan = startupPlan("usr_a", q);
    assert.equal(plan.paintSkin, false, `${q} wins over By day and At night`);
    assert.equal(plan.look?.rm, true, "the display choices still apply");
  }
  assert.deepEqual(JSON.parse(mem.get("vyre.look.usr_a")!).day, "linen", "the saved look is untouched");
});
