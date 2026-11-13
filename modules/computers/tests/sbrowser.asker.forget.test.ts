// An agent that has been in Trash as long as Trash keeps things loses its browser profile, and with it the profiles of the people who used it without owning it (owner, 13 Nov 2026, P7 section 10 item 6):
// their sign-ins are as much the agent's as the owner's, and must not stay on the disk for ever once the agent is gone. The stand-in browser records what it is told to forget.
import test from "node:test";
import assert from "node:assert/strict";
import { bindSpaceBrowser } from "../sbrowser/port.ts";
import type { SpaceBrowser } from "../sbrowser/port.ts";
import { forgetExpired } from "../sbrowser/forget.ts";
import { askerProfileId } from "../sbrowser/policy.ts";
import { harness } from "../fixtures/harness.ts";

const AG = "agt_01a1d4e073004405af63151b48dcb667";

test("an agent's profile and those of the people who used it are all forgotten when its Trash time is up; one still inside it keeps its own", async () => {
  const forgotten: string[] = [];
  bindSpaceBrowser({
    async available() {
      return true;
    },
    async forget(id: string) {
      forgotten.push(id);
    },
  } as unknown as SpaceBrowser);
  try {
    const h = harness();
    h.respond["access.principals.list"] = () => ({
      principals: [
        { kind: "person", id: "usr_ana" },
        { kind: "person", id: "usr_ben" },
        { kind: "agent", id: AG },
      ],
    });
    h.db.run("INSERT INTO computers_browser_gone (profile_id, deleted_at) VALUES (?, ?)", AG, 1);
    h.db.run("INSERT INTO computers_browser_gone (profile_id, deleted_at) VALUES (?, ?)", "agt_stillhere", h.ctx.now());
    const done = await forgetExpired(h.ctx);
    assert.deepEqual(done, [AG]);
    assert.deepEqual(
      forgotten.sort(),
      [AG, askerProfileId(AG, "usr_ana")!, askerProfileId(AG, "usr_ben")!].sort(),
      "the agent's, Ana's and Ben's; no person profile for the agent id itself, none for the one in Trash less long",
    );
  } finally {
    bindSpaceBrowser(null);
  }
});
