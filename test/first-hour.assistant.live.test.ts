// A fresh server's first hour, the part the privacy rules must never break: a person's new agent has its home folder, made by the server (the agents module looks up the Agents root
// as the host), and a person still finds only what they may view. host/tests/sites.agent.test.ts is the broader regression: it failed when files.resolve and files.folder.search stopped answering the server.
import test from "node:test";
import assert from "node:assert/strict";
import { CORE_SPACE } from "../fixtures/seed/core/index.ts";
import { boot, seededDir, stop } from "./support/eco-live.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";
import type { EngineSession, OpenSession } from "../agent/src/turn-engine/types.ts";

const WHO = ["usr_olivia", "usr_mia"];

test("a fresh Space: a person's new agent gets its home folder, made by the server,, and finds the folders they may view by name", { timeout: 180_000 }, async () => {
  const idle: OpenSession = async () =>
    ({
      warm: true,
      async *send() {
        yield { type: "done" as const };
      },
      sendToolResult() {},
      inject() {},
      async cancel() {},
      async close() {},
    }) as unknown as EngineSession;
  const ownerToken = { v: "" };
  const d: Daemon = await boot(seededDir(), idle, {
    vault: undefined,
    session: (headers: Record<string, string | undefined>) => {
      const t = String(headers["authorization"] ?? "").replace(/^Bearer /, "");
      const id = t === ownerToken.v ? "usr_olivia" : t;
      return WHO.includes(id) ? { space: CORE_SPACE, principal: { kind: "person" as const, id }, device: "first-hour" } : null;
    },
  });
  ownerToken.v = d.token;
  const ok = async (who: string, cap: string, input: Record<string, unknown>): Promise<any> => {
    // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${who}` },
      body: JSON.stringify(input),
    });
    const b = (await r.json()) as { data?: unknown };
    assert.equal(r.status, 200, `${cap} as ${who}: ${JSON.stringify(b).slice(0, 300)}`);
    return b.data ?? b;
  };
  try {
    // the server makes the agent's home folder under the Agents root, which it looks up as itself
    for (const who of WHO) {
      const made = await ok(who, "agents.create", { name: `Helper of ${who.slice(4)}`, role: "You help.", idempotencyKey: `fh-${who}` });
      assert.ok(made.agent.folderId, `${who}'s agent has a home folder`);
      const folder = await ok(who, "files.folder.get", { folderId: made.agent.folderId });
      assert.equal(folder.folder.folderId, made.agent.folderId);
    }
    const found = await ok("usr_olivia", "files.folder.search", { q: "Agents", scope: "folders" });
    assert.ok(
      found.folders.some((f: { name: string }) => f.name === "Agents"),
      "a person finds the Agents root they may view",
    );
  } finally {
    await stop(d);
  }
});
