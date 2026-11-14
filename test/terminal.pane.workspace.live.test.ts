// @heavy docker
// The chat's Terminal tab on a real agent workspace (12 Nov, audit items 14 and 15): Open terminal opens the agent's workspace (a real container and tmux, no stand-in), and the tab's live view keeps
// up with a long build: the last lines it printed are on the screen while it runs and when it ends. Needs Docker (VYRE_HEAVY_DOCKER=1, VYRE_WORKSPACE_IMAGE naming a workspace image), the production
// web export (VYRE_APP_DIST) and Chromium. Screenshots go to shots-evidence/terminal-pane-workspace/.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { connectClaude, makeAgent, unlockVault } from "./support/mail-world.ts";
import { bootScreens, browserOrSkip, open, seat, shoot } from "./support/mail-browser.ts";
import { standIn } from "./memory-live-kit.ts";
import { guardCrashes } from "../apps/app/tests/crash-guard.ts";

const ON = process.env["VYRE_HEAVY_DOCKER"] === "1" && process.env["VYRE_WORKSPACE_IMAGE"] !== undefined;
const skip: string | false = ON
  ? false
  : "needs VYRE_HEAVY_DOCKER=1 and VYRE_WORKSPACE_IMAGE (the workspace is a real container)";
const docker = (args: string[]): Promise<number> =>
  new Promise((r) => {
    execFile("docker", args, { timeout: 60_000 }, (e) => r(e ? 1 : 0));
  });

test(
  "the chat's Terminal tab opens the agent's real workspace, and its live view follows a long build to the end",
  { skip, timeout: 600_000 },
  async (t) => {
    const env = await browserOrSkip();
    if (typeof env === "string") {
      t.skip(env);
      return;
    }
    const s = await bootScreens({ kind: "team", engineOpenSession: standIn }, env);
    const dir = "shots-evidence/terminal-pane-workspace";
    let agentId = "";
    try {
      const w = s.world;
      await unlockVault(w);
      agentId = await makeAgent(w.owner, "Desk", await connectClaude(w));
      const ws = (await w.owner.ok("terminal.workspace", { agentId })) as { state: string; canAttach: boolean };
      assert.equal(ws.canAttach, true, `the owner may attach to a team agent's workspace: ${JSON.stringify(ws)}`);
      await w.owner.ok("chat.start", { kind: "chat", agentIds: [agentId], title: "Desk work" });
      const me = await seat(s, w.owner, "Owner");
      const guard = guardCrashes(me.page);
      await open(me, s, "/chat");
      await me.page.getByTestId("chats-place").waitFor({ timeout: 20_000 });
      await me.page.getByText("Desk work", { exact: true }).first().click();
      await me.page.getByTestId("composer-field").waitFor({ timeout: 20_000 });
      if ((await me.page.getByTestId("pane-agent").count()) === 0) await me.page.getByTestId("pane-button").click();
      await me.page.getByTestId("pane-agent").waitFor({ timeout: 20_000 });
      if ((await me.page.getByTestId("tab-terminal").count()) > 0) await me.page.getByTestId("tab-terminal").click();
      else {
        await me.page.getByTestId("tab-more").click();
        await me.page
          .getByRole("menuitem", { name: "Terminal" })
          .or(me.page.getByRole("button", { name: "Terminal", exact: true }))
          .first()
          .click();
      }
      await me.page.getByTestId("terminal-pane-open").click();
      await me.page.getByTestId("terminal-tab").waitFor({ timeout: 60_000 });
      await guard.check("the workspace terminal opened");
      // it is the agent's workspace: a real container, and the tab lists as one
      const rows = (await w.owner.ok("terminal.list", {})).terminals as Array<{
        host: string;
        agentId?: string;
        hostTitle: string;
      }>;
      assert.ok(
        rows.some((r) => r.host === "agent_computer" && r.agentId === agentId && r.hostTitle === "Workspace"),
        JSON.stringify(rows),
      );
      assert.equal(await docker(["inspect", `vyre-ws-${agentId}`]), 0, "the workspace container exists");
      await me.page.getByText("Workspace", { exact: false }).first().waitFor({ timeout: 20_000 });
      await shoot(me.page, dir, "pane-workspace-open");
      // a long build, typed in the tab: 6,000 lines, more than the 5,000 the live view used to keep up with
      await me.page.getByTestId("terminal-tab").click();
      await me.page.keyboard.type(
        "for i in $(seq 1 6000); do echo build step $i; [ $((i % 200)) -eq 0 ] && sleep 0.4; done; echo BUILD DONE",
      );
      await me.page.getByText("echo BUILD DONE", { exact: false }).first().waitFor({ timeout: 120_000 });
      await me.page.keyboard.press("Enter");
      await me.page
        .getByText(/build step (3|4|5)\d\d\d/)
        .first()
        .waitFor({ timeout: 120_000 })
        .catch(async (e: unknown) => {
          await shoot(me.page, dir, "stalled");
          throw e;
        });
      await shoot(me.page, dir, "live-view-during-build");
      await me.page.getByText("BUILD DONE", { exact: false }).last().waitFor({ timeout: 180_000 });
      assert.ok(
        (await me.page.getByText("build step 6000", { exact: false }).count()) > 0,
        "the last line of the build is on the screen",
      );
      // and in view: the screen follows the output to its end, past the 2,000 rows it keeps
      const inView = async (): Promise<boolean> => {
        const box = await me.page.getByTestId("terminal-scroll").boundingBox();
        const line = await me.page.getByText("BUILD DONE", { exact: true }).last().boundingBox();
        return box !== null && line !== null && line.y >= box.y && line.y + line.height <= box.y + box.height + 1;
      };
      for (let i = 0; i < 40 && !(await inView()); i++) await me.page.waitForTimeout(250);
      if (!(await inView())) {
        await shoot(me.page, dir, "not-in-view");
        const m = await me.page.evaluate(() => {
          const el = document.querySelector('[data-testid="terminal-scroll"]') as HTMLElement | null;
          const inner = el?.querySelector("div") as HTMLElement | null;
          return el
            ? {
                top: el.scrollTop,
                height: el.scrollHeight,
                client: el.clientHeight,
                innerTop: inner?.scrollTop,
                innerHeight: inner?.scrollHeight,
                innerClient: inner?.clientHeight,
              }
            : null;
        });
        t.diagnostic(
          `scroll: ${JSON.stringify(m)} box ${JSON.stringify(await me.page.getByTestId("terminal-scroll").boundingBox())} line ${JSON.stringify(await me.page.getByText("BUILD DONE", { exact: true }).last().boundingBox())}`,
        );
      }
      assert.ok(await inView(), "the build's last line is in view, not below it");
      await shoot(me.page, dir, "live-view-build-done");
      assert.deepEqual(me.errors, [], "no page errors");
    } finally {
      await s.close();
      if (agentId !== "") {
        await docker(["rm", "-f", `vyre-ws-${agentId}`]);
        await docker(["volume", "rm", "-f", `vyre-ws-${agentId}-home`, `vyre-ws-${agentId}-files`, `vyre-ws-${agentId}-people`]);
      }
    }
  },
);
