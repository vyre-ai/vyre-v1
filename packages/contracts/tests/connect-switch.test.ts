// @reads /manifests/vault-requests.ts
// @reads /manifests/vault.ts
// @reads /manifests/connectors.ts
// The connect card's switch (lib/connect-switch.ts, rc.28): the one list of capabilities it gates is the whole of what the connect work added, each declares the plain refusal it answers with, and
// vault.item.discard_new is no agent tool at all (review r-keyreach-9-b-connect, item C2), switch on or off.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { all } from "../../../manifests/index.ts";
import { CONNECT_CAPS, CONNECT_OFF_CODE } from "../../../lib/connect-switch.ts";
import type { CapabilityDef } from "../src/index.ts";

const caps = new Map<string, CapabilityDef>();
for (const m of all) for (const c of m.capabilities ?? []) caps.set(c.name, c);

test("every gated capability exists and declares the refusal it answers with", () => {
  for (const name of CONNECT_CAPS) {
    const c = caps.get(name);
    assert.ok(c, `${name} is not a capability`);
    assert.ok((c.errors ?? []).includes(CONNECT_OFF_CODE), `${name} does not declare ${CONNECT_OFF_CODE}`);
  }
});

test("no connect capability is missing from the switch's list", () => {
  const connectish = [...caps.keys()].filter(
    (n) =>
      n === "vault.connect" ||
      n.startsWith("vault.connect_card.") ||
      n === "connectors.for_service" ||
      n === "connectors.check_key" ||
      n === "vault.item.discard_new",
  );
  assert.deepEqual(connectish.sort(), [...CONNECT_CAPS].sort());
});

test("vault.item.discard_new is not an agent tool: no MCP surface, never visible to agents", () => {
  const c = caps.get("vault.item.discard_new")!;
  assert.equal(c.surfaces.mcp, undefined);
  const tools = (
    JSON.parse(readFileSync(new URL("../../../generated/mcp-tools.json", import.meta.url), "utf8")) as {
      tools: { cap: string | null }[];
    }
  ).tools;
  assert.equal(
    tools.some((t) => t.cap === "vault.item.discard_new"),
    false,
  );
});
