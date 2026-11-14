// The person sees and ends their agent's reach on a thing it made. Booted daemon, the real tool pipeline: Olivia's agent publishes a page for her (a private root, so the maker's reach is the agent's only way in),
// the sharing list shows "made this for you" with its level, the agent reads it; she removes that row, and the same agent is refused on its next call; it comes back only when she shares it again.
import test from "node:test";
import assert from "node:assert/strict";
import { bootReach } from "./support/reach-kit.ts";

test(
  "the maker's reach shows in the sharing list and ends when the person removes it",
  { timeout: 100_000 },
  async () => {
    const r = await bootReach();
    try {
      const made = await r.chain("owner", [
        {
          k: "make",
          tool: "artifact_publish",
          input: () => ({ title: "Olivia page", html: "<!doctype html><h1>o</h1>" }),
        },
        { k: "read", tool: "sites_get", input: (o) => ({ siteId: o["make"]!.json.artifactId }) },
      ]);
      const siteId = made["make"]?.json?.artifactId as string;
      assert.ok(siteId, "the agent published it");
      assert.equal(made["read"]?.ok, true, `the agent reads what it made: ${made["read"]?.text.slice(0, 200)}`);
      const agent = r.assistant("owner");
      const resource = { type: "site", id: siteId };
      const listed = await r.must("owner", "access.shares_of", { resource });
      const row = (
        listed.shares as Array<{ grant: { id: string; level: string; source?: string; subject: { id: string } } }>
      ).find((s) => s.grant.subject.id === agent);
      assert.ok(row, `the sharing list shows the maker: ${JSON.stringify(listed.shares).slice(0, 300)}`);
      assert.equal(row!.grant.source, "made_by");
      assert.equal(row!.grant.level, "edit");
      // she removes it, as the sheet does: unshare by the row's id
      await r.must("owner", "access.unshare", { grantId: row!.grant.id });
      const after = await r.chain("owner", [{ k: "read", tool: "sites_get", input: () => ({ siteId }) }]);
      assert.equal(after["read"]?.ok, false, "the agent is refused like any other agent");
      const gone = await r.must("owner", "access.shares_of", { resource });
      assert.ok(
        !(gone.shares as Array<{ grant: { subject: { id: string } } }>).some((s) => s.grant.subject.id === agent),
        "and the row is gone",
      );
      // shared again on purpose: back
      await r.must("owner", "access.share", { resource, subject: { kind: "agent", id: agent }, level: "edit" });
      const back = await r.chain("owner", [{ k: "read", tool: "sites_get", input: () => ({ siteId }) }]);
      assert.equal(back["read"]?.ok, true, "shared again, it can use it again");
    } finally {
      await r.stop();
    }
  },
);
