// Live bug (rc.14 team Space): a member opening Records and Settings was refused console.nav and connectors.list, because the UI asked to find out whether they may edit the schema,
// manage a sync or open the Console. A Member or Guest holds none of those (manifests/permissions.ts), so the UI now knows and does not ask; anyone else still asks.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import type { ReactElement } from "react";
import { installDom, mount } from "../../../../../ui/src/testing/dom.ts";
import { useCanEditSchema, useCanManageSync } from "./records.tsx";
import type { ShellRuntime } from "./runtime.tsx";

function Probe({ rt, out }: { rt: ShellRuntime; out: { schema?: boolean; sync?: boolean } }): ReactElement | null {
  out.schema = useCanEditSchema(rt);
  out.sync = useCanManageSync(rt);
  return null;
}

const runtime = (plainRole: boolean | undefined, calls: string[]): ShellRuntime => ({
  space: { id: "spc_team", kind: "team", name: "Team" },
  ...(plainRole !== undefined ? { plainRole } : {}),
  call: async (cap: string) => { calls.push(cap); return cap === "console.nav" ? { groups: [{ pages: [{ key: "schema" }] }] } : { connectors: [] }; },
}) as unknown as ShellRuntime;

test("a plain member's Records asks neither console.nav nor connectors.list, and gets no schema or sync controls", async () => {
  const restore = installDom();
  try {
    const calls: string[] = [];
    const out: { schema?: boolean; sync?: boolean } = {};
    await mount(createRoot, <Probe rt={runtime(true, calls)} out={out} />);
    assert.deepEqual(calls, []);
    assert.equal(out.schema, false);
    assert.equal(out.sync, false);
  } finally { restore(); }
});

test("an owner, or a role the server must answer for, still asks", async () => {
  const restore = installDom();
  try {
    for (const plain of [false, undefined]) {
      const calls: string[] = [];
      await mount(createRoot, <Probe rt={runtime(plain, calls)} out={{}} />);
      assert.deepEqual(calls.sort(), ["connectors.list", "console.nav"], String(plain));
    }
  } finally { restore(); }
});
