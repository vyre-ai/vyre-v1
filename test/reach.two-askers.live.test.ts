// One shared agent, two people (owner Olivia and member Noah). What the agent makes for Olivia is hers: when Noah asks the same agent, it gets nothing of it, not to read, not to change, not to remove, and not
// through a hold either: Olivia's parked archive of her channel is hers to answer, and Noah's ask does not move it. And the other way, so the rule is not one-sided.
import test from "node:test";
import assert from "node:assert/strict";
import { bootReach, find } from "./support/reach-kit.ts";

test(
  "one shared agent, two askers: the second gets nothing of what it made for the first, also while a hold is waiting",
  { timeout: 115_000 },
  async () => {
    const r = await bootReach();
    try {
      const shared = (await r.must("owner", "agents.create", { name: "Shared helper", role: "You help the team." }))
        .agent.agentId as string;
      // for Olivia: a private channel and a page in her own artifacts
      const made = await r.chain(
        "owner",
        [
          { k: "chan", tool: "channels_create", input: () => ({ name: "olivia-private", visibility: "invite" }) },
          {
            k: "page",
            tool: "artifact_publish",
            input: () => ({ title: "Olivia page", html: "<!doctype html><h1>o</h1>" }),
          },
          // her agent asks to archive it: the call parks for her yes
          { k: "archive", tool: "channels_archive", input: (o) => ({ channelId: o["chan"]!.json.channel.channelId }) },
        ],
        undefined,
        shared,
      );
      const channelId = made["chan"]?.json?.channel?.channelId as string;
      const pageId = made["page"]?.json?.artifactId as string;
      assert.ok(channelId && pageId, "the agent made both for Olivia");
      assert.match(made["archive"]?.text ?? "", /NO ANSWER/, "the archive waits for Olivia's yes");
      // Noah asks the same agent for the same things, while that hold is waiting
      const theirs = await r.chain(
        "member",
        [
          { k: "read", tool: "channels_get", input: () => ({ channelId }) },
          { k: "change", tool: "channels_update", input: () => ({ channelId, topic: "mine now" }) },
          { k: "archive", tool: "channels_archive", input: () => ({ channelId }) },
          { k: "page", tool: "sites_get", input: () => ({ siteId: pageId }) },
          {
            k: "page change",
            tool: "artifact_publish",
            input: () => ({ artifactId: pageId, title: "taken", html: "<!doctype html><h1>n</h1>" }),
          },
        ],
        undefined,
        shared,
      );
      for (const k of ["read", "change", "archive", "page", "page change"])
        assert.equal(
          theirs[k]?.ok,
          false,
          `asked by Noah, the shared agent gets nothing of Olivia's (${k}): ${theirs[k]?.text.slice(0, 160)}`,
        );
      // nothing of hers moved: still open, topic unchanged, page title unchanged
      const chan = await r.must("owner", "channels.get", { channelId });
      assert.equal(chan.channel.archived, false, "Olivia's channel is not archived by Noah's ask");
      assert.notEqual(chan.channel.topic, "mine now");
      // and Noah's own things, made by the same agent, are his and not Olivia's
      const noahs = await r.chain(
        "member",
        [{ k: "chan", tool: "channels_create", input: () => ({ name: "noah-private", visibility: "invite" }) }],
        undefined,
        shared,
      );
      const noahChannel = noahs["chan"]?.json?.channel?.channelId as string;
      assert.ok(noahChannel, "the agent makes Noah's own");
      const back = await r.chain(
        "owner",
        [{ k: "read", tool: "channels_get", input: () => ({ channelId: noahChannel }) }],
        undefined,
        shared,
      );
      assert.equal(back["read"]?.ok, false, "asked by Olivia, the shared agent gets nothing of Noah's");
      void find;
    } finally {
      await r.stop();
    }
  },
);
