// A host build with no connector port cannot check where a key goes (review of 77603b1d6, item 8): a request that carries a credential is refused in words and never reaches the host's plain fetch.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";

process.env["VYRE_CONNECT_CARD"] = "1";

test("with no connector port, a typed key is refused with a plain sentence and nothing is sent by the unguarded fetch", async () => {
  const sent: string[] = [];
  const ctx = {
    space: "spc_x",
    trace: { traceId: "0123456789abcdef0123456789abcdef" },
    principal: { kind: "person", id: "usr_dana" },
    emit: () => null,
    call: async () => ({}),
    http: async (url: string) => {
      sent.push(url);
      return { status: 200, text: async () => "{}" };
    },
    authorize: () => ({ effect: "allow" }),
    log: { info() {}, warn() {}, error() {} },
  } as never;
  await assert.rejects(
    handlers["connectors.check_key"](ctx, { connector: "fathom", secrets: { api_key: "fk_live_TYPED_0001" } } as never),
    (e: { error?: { message?: string } }) => /This server cannot check keys yet/.test(e.error?.message ?? ""),
  );
  assert.deepEqual(sent, [], "the key reached nobody");
});
