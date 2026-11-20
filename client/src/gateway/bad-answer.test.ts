import test from "node:test";
import assert from "node:assert/strict";
import { BAD_ANSWER, CapError, createCapCaller } from "./index.ts";

const routes = async () => [
  { method: "POST", path: "/v1/identity/sign_in_options", cap: "identity.sign_in_options", v: 1 },
];
const call = (answer: () => Response) =>
  createCapCaller({
    baseUrl: "https://a.example",
    token: () => null,
    routes,
    fetch: (async () => answer()) as typeof fetch,
  })("identity.sign_in_options", {});

test("a 200 that is not JSON (a proxy, a captive portal, a relay page) is an error that says what answered, never an empty success", async () => {
  await assert.rejects(
    call(
      () =>
        new Response("<!doctype html><title>login</title>", { status: 200, headers: { "content-type": "text/html" } }),
    ),
    (e: unknown) => {
      assert.ok(e instanceof CapError);
      assert.equal(e.code, BAD_ANSWER);
      assert.equal(e.status, 200);
      assert.deepEqual(e.details, { contentType: "text/html" });
      return true;
    },
  );
  await assert.rejects(
    call(() => new Response("", { status: 200 })),
    (e: unknown) => e instanceof CapError && e.code === BAD_ANSWER,
    "an empty 200 too",
  );
});

test("a JSON answer still resolves, a 204 still says nothing, and an error status keeps the error it always gave", async () => {
  const ok = await call(
    () =>
      new Response(JSON.stringify({ data: { name: "Northwind" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  assert.deepEqual(ok, { name: "Northwind" });
  assert.equal(await call(() => new Response(null, { status: 204 })), undefined);
  await assert.rejects(
    call(() => new Response("<html>bad gateway</html>", { status: 502, headers: { "content-type": "text/html" } })),
    (e: unknown) => e instanceof CapError && e.status === 502 && e.code !== BAD_ANSWER,
  );
});
