// Caddy's access log for sites: the config that is written, that it is written once, put right after a restart, and the loopback listener that takes the lines (r42-sites-run).
import assert from "node:assert/strict";
import net from "node:net";
import { test } from "node:test";
import { CaddyAdmin } from "./admin.ts";
import { ACCESS_LOG, MAX_LINE, accessLogConfig, ensureAccessLog, startAccessSink } from "./accesslog.ts";
import { FakeCaddy } from "./fake.ts";

test("the config sends only finished-request lines to this machine's port, with headers removed", () => {
  const c = accessLogConfig(4321);
  assert.deepEqual(c.log["writer"], {
    output: "net",
    address: "tcp/127.0.0.1:4321",
    dial_timeout: "2s",
    soft_start: true,
  });
  assert.deepEqual(c.log["include"], ["http.log.access.vyre"]);
  const fields = (c.log["encoder"] as { fields: Record<string, unknown> }).fields;
  assert.deepEqual(fields["request>headers"], { filter: "delete" }, "cookies and tokens never leave Caddy");
  assert.deepEqual(fields["resp_headers"], { filter: "delete" });
  assert.deepEqual(c.server, { default_logger_name: "vyre" });
});

function world() {
  const fake = new FakeCaddy();
  fake.config = { apps: { http: { servers: { vyre: { listen: [":443"], routes: [] } } } } };
  return { fake, admin: new CaddyAdmin({ fetch: fake.fetch }) };
}

test("the first call writes the log and the server's switch; the second changes nothing; a new port is put right", async () => {
  const w = world();
  assert.equal(await ensureAccessLog(w.admin, 4000), "set");
  const logging = w.fake.config?.["logging"] as { logs: Record<string, { writer: { address: string } }> };
  assert.equal(logging.logs[ACCESS_LOG]?.writer.address, "tcp/127.0.0.1:4000");
  const writes = w.fake.calls.filter((c) => c.method !== "GET").length;
  assert.equal(await ensureAccessLog(w.admin, 4000), "same");
  assert.equal(w.fake.calls.filter((c) => c.method !== "GET").length, writes, "no write the second time");
  assert.equal(await ensureAccessLog(w.admin, 4001), "set");
  assert.equal((w.fake.config?.["logging"] as typeof logging).logs[ACCESS_LOG]?.writer.address, "tcp/127.0.0.1:4001");
});

test("a Caddy that restarted and lost the log gets it again, and one with other logs keeps them", async () => {
  const w = world();
  (w.fake.config as Record<string, unknown>)["logging"] = { logs: { default: { level: "INFO" } } };
  await ensureAccessLog(w.admin, 4000);
  const logs = (w.fake.config?.["logging"] as { logs: Record<string, unknown> }).logs;
  assert.ok(logs["default"], "another log is kept");
  assert.ok(logs[ACCESS_LOG]);
});

test("the listener hands over each line, across chunks, and ignores blank lines", async (t) => {
  const got: string[] = [];
  const sink = await startAccessSink((l) => got.push(l));
  t.after(() => sink.close());
  await new Promise<void>((resolve) => {
    const s = net.connect(sink.port, "127.0.0.1", () => {
      s.write('{"a":1}\n{"b"');
      setTimeout(() => {
        s.end(':2}\n\n{"c":3}\n');
        setTimeout(resolve, 50);
      }, 20);
    });
  });
  assert.deepEqual(got, ['{"a":1}', '{"b":2}', '{"c":3}']);
});

test("a line that never ends closes the connection, and a throwing handler does not stop the rest", async (t) => {
  const got: string[] = [];
  const sink = await startAccessSink((l) => {
    got.push(l);
    if (l === "boom") throw new Error("no");
  });
  t.after(() => sink.close());
  const closed = await new Promise<boolean>((resolve) => {
    const s = net.connect(sink.port, "127.0.0.1", () => s.write("x".repeat(MAX_LINE + 10)));
    s.on("close", () => resolve(true));
    setTimeout(() => resolve(false), 1000);
  });
  assert.equal(closed, true);
  await new Promise<void>((resolve) => {
    const s = net.connect(sink.port, "127.0.0.1", () => s.end("boom\nfine\n"));
    s.on("close", () => setTimeout(resolve, 20));
  });
  assert.deepEqual(got, ["boom", "fine"]);
});
