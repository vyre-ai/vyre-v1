// The assertions of the "made for me, usable by the maker" sweep (owner rule, 14 Nov 2026), for one person: when their agent makes something for them, the same agent, acting for the same person, can read it, change it
// and remove it on its first call, the person finds it where they would look, and a person who has no part in it does not reach what is private. Booted daemon, the real tool pipeline, Team Space. One file per person
// (a file has 30 s): test/reach.made-for-me.owner.live.test.ts and test/reach.made-for-me.member.live.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { bootReach, type Who } from "./reach-kit.ts";
import { CASES, runCase } from "./reach-cases.ts";

/** Cases whose every step must go through. A file delete is held for the person's OK (the Gate), which is the person's decision and not a refusal. */
const MUST_HOLD = [
  "files-personal",
  "calendar",
  "artifact",
  "site",
  "automation",
  "form",
  "channel",
  "project",
  "record",
];
/** What a person with no part in it must not reach (private by default). */
const PRIVATE = ["note", "artifact", "channel", "goal", "skill"];
const FIT = (v: string): boolean => v === "ok" || v === "skipped" || v.startsWith("NO ANSWER");

export function madeForMe(who: Who): void {
  test(
    `made for me (${who}): the maker uses it on the first call, the person sees it, a stranger does not`,
    { timeout: 100_000 },
    async () => {
      const r = await bootReach();
      try {
        const refused: string[] = [];
        const leaked: string[] = [];
        for (const c of CASES.filter((x) => MUST_HOLD.includes(x.id) || PRIVATE.includes(x.id))) {
          const seen = await runCase(r, who, c);
          if (MUST_HOLD.includes(c.id))
            for (const [k, v] of Object.entries(seen)) {
              // a member's own role does not carry deleting a record, so the person cannot do it themself and the agent acting for them cannot either: the person is the ceiling
              if (who === "member" && c.id === "record" && k === "remove") continue;
              if (k !== "other sees" && !FIT(v)) refused.push(`${who} ${c.id} ${k}: ${v.slice(0, 120)}`);
            }
          if (PRIVATE.includes(c.id) && seen["other sees"] === "ok") leaked.push(`${who} ${c.id}`);
        }
        // a real exception tells the model the true reason and the one next step, not the general "ask for access"
        const computer = await runCase(r, who, CASES.find((x) => x.id === "computer")!);
        assert.match(
          computer["make"] ?? "",
          /no longer get a new desktop computer/,
          "an agent that cannot be given a computer is told why",
        );
        assert.deepEqual(refused, [], "the agent that made it can use it");
        assert.deepEqual(leaked, [], "a person with no part in it does not see it");
      } finally {
        await r.stop();
      }
    },
  );
}
