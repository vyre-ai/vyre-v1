// @heavy docker
// The wall, not the words (lead, 14 Nov 2026, review H1 to H3): a person who does not own a shared agent works as a Unix user of their own in the agent's computer, so what the operating system refuses
// holds whatever the command says. Every probe below is spelled so that the friendly refusal in front of the tool layer cannot see it (a path built in the shell, a script file, python, typed into a
// terminal), and each must fail with the kernel's own "Permission denied" or "Operation not permitted", never print the owner's or another person's content.
import test from "node:test";
import assert from "node:assert/strict";
import { world } from "./support/agentpc-world.ts";

const ON = process.env["VYRE_HEAVY_DOCKER"] === "1" && process.env["VYRE_WORKSPACE_TEST_IMAGE"] !== undefined;
const skip: string | false = ON ? false : "needs VYRE_HEAVY_DOCKER=1 and VYRE_WORKSPACE_TEST_IMAGE (the workspace is a real container)";
const KERNEL = /Permission denied|Operation not permitted/;
const SECRET = /OWNER-|ANA-/;

test(
  "as a non-owner, in an agent turn, through terminal_run and terminal_input, the owner's and another person's files, processes and sockets are refused by the kernel",
  { skip, timeout: 1_200_000 },
  async (t) => {
    const w = await world();
    t.after(() => w.close());
    // the owner's things: a token, a key, a file in /tmp left as the shell made it, and a running tmux server (her session)
    const mine = await w.turn(w.owner, "wall-owner", [
      { cmd: 'echo OWNER-TOKEN-4411 > ~/owner-token; D="$HOME/.s""sh"; mkdir -p "$D"; echo OWNER-KEY > "$D/id_ed25519"; echo OWNER-TMP > /tmp/owner-tmp; echo done' },
    ]);
    assert.equal(mine[0]!.text, "done");
    const ana = await w.turn(w.ana, "wall-ana", [{ cmd: "echo ANA-SECRET-9 > ~/a-private.txt; echo done" }]);
    assert.equal(ana[0]!.text, "done");

    const H = 'H=/home/ag""ent;';
    const probes: Array<[string, { cmd: string; typed?: string }]> = [
      ["the owner's token by a path the words cannot see", { cmd: `${H} cat $H/owner-token 2>&1` }],
      ["the owner's home listed", { cmd: `${H} ls -A $H 2>&1` }],
      ["the owner's key", { cmd: `${H} cat $H/.s""sh/id_ed25519 2>&1` }],
      ["the owner's token by python", { cmd: `python3 -c "print(open('/home/'+'agent/owner-token').read())" 2>&1` }],
      ["the owner's token by a script file", { cmd: `printf '%s\\n' 'cat /home/ag""ent/owner-token 2>&1' > ~/w.sh; sh ~/w.sh` }],
      ["the owner's token by climbing out of his home", { cmd: "cat ~/../../home/ag\"\"ent/owner-token 2>&1" }],
      ["the owner's tmux socket", { cmd: "tmux -S /tmp/tmux-10001/default ls 2>&1; echo END" }],
      ["the owner's running processes: environment", { cmd: "P=$(pgrep -u 10001 -o tmux); cat /proc/$P/environ 2>&1 | head -c 120; echo END" }],
      ["the owner's running processes: working folder", { cmd: "P=$(pgrep -u 10001 -o tmux); ls -l /proc/$P/cwd 2>&1; echo END" }],
      ["a file the owner left in /tmp as the shell made it", { cmd: "cat /tmp/owner-tmp 2>&1" }],
      ["a signal to the owner's processes", { cmd: "kill -9 $(pgrep -u 10001 -o tmux) 2>&1; echo END" }],
      ["another person's file, by a path built in the shell (Ana is u20000)", { cmd: 'P=/peo""ple; cat $P/u20000/a-private.txt 2>&1; ls $P/u20000 2>&1' }],
      ["the owner's token typed into a terminal", { cmd: "", typed: `${H} cat $H/owner-token 2>&1` }],
    ];
    const got = await w.turn(
      w.ben,
      "wall-ben",
      probes.map(([, p]) => p),
    );
    const failures: string[] = [];
    probes.forEach(([what], i) => {
      const text = got[i]!.text;
      if (SECRET.test(text)) failures.push(`${what}: PRINTED ${JSON.stringify(text.slice(0, 160))}`);
      else if (!KERNEL.test(text)) failures.push(`${what}: no kernel refusal: ${JSON.stringify(text.slice(0, 160))}`);
    });
    console.log("WALL", JSON.stringify(got.map((g) => g.text.slice(0, 80))));
    assert.deepEqual(failures, []);
  },
);
