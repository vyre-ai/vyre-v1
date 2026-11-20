// @tsx
// A tap goes where it says on a project's Plan (phone, 390 wide): one tap on a task opens it. A bar, a card or a row used to only select the task, and opening was a double click.
import test from "node:test";
import assert from "node:assert/strict";
import { bootNav } from "./r32-nav-kit.test.ts";

test("phone project Plan: one tap on a task opens it", async (t) => {
  const k = await bootNav({ width: 390, height: 844, scheme: "light", phone: true, tag: "phone-plan-tap" });
  if (!k) {
    t.skip("VYRE_APP_DIST required");
    return;
  }
  const { page, api } = k;
  try {
    const me = (await page.evaluate(
      `JSON.parse(localStorage.getItem("vyre.session.v1")).sessions[location.origin].personId`,
    )) as string;
    const project = (await api("projects.create", {
      type: "project",
      title: "Probate GTM",
      idempotencyKey: "r41-proj",
    })) as {
      projectId: string;
      recordId: string;
    };
    // a plan draws a task in a stage: no stage, no row
    await api("projects.stages.set", {
      projectId: project.projectId,
      stages: [{ title: "To do" }, { title: "Doing" }],
      idempotencyKey: "r41-stages",
    });
    for (const title of ["Draft the letter", "Call the court"])
      await api("tasks.create", {
        title,
        assigned: { kind: "person", id: me },
        recordId: project.recordId,
        start: Date.now(),
        due: Date.now() + 2 * 86_400_000,
        idempotencyKey: `r41-task-${title}`,
      });
    const projectUrl = `${page.url().split("#")[0].split("?")[0]}#subject=project:${project.projectId}`;
    const screens = `[...document.querySelectorAll('[data-testid^="screen-"]')].map((e) => e.getAttribute("data-testid")).join(",")`;
    const openPlan = async (): Promise<string> => {
      await page.goto(projectUrl, { waitUntil: "load" });
      await page.reload({ waitUntil: "load" });
      await page.getByTestId("tabname-plan").click();
      await page.locator('[data-testid^="plan-row-"]').first().waitFor({ timeout: 20_000 });
      return (await page.evaluate(screens)) as string;
    };
    const opened = (before: string): Promise<unknown> =>
      page.waitForFunction(`(${screens}) !== ${JSON.stringify(before)}`, null, { timeout: 10_000 });

    // a tap on a task's name in the list down the left side
    let before = await openPlan();
    await page.locator('[data-testid^="plan-row-"]').first().click();
    await opened(before);

    // a tap on a task's bar (scrolled clear of the names down the left), with a finger (a real touch): a quick press and release with no drag opens it.
    // Not in the middle: a short bar's middle is the avatar of who it is assigned to, and that opens the assign menu (its own pointer-down stops the press).
    before = await openPlan();
    const bar = page.locator('[data-testid^="plan-bar-"]').first();
    await bar.waitFor({ state: "attached", timeout: 20_000 });
    await bar.evaluate((el) => {
      const sc = el.closest('[data-testid="plan-scroll"]') as HTMLElement;
      sc.scrollLeft += el.getBoundingClientRect().x - 260;
    });
    const cdp = await page.context().newCDPSession(page);
    const bb = (await bar.boundingBox())!;
    const at = { x: Math.round(bb.x + bb.width - 4), y: Math.round(bb.y + bb.height / 2) };
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [at] });
    await page.waitForTimeout(60);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await opened(before);

    // the List view: a tap on a row of the list
    before = await openPlan();
    await page.getByTestId("plan-view").click();
    await page.getByText("List", { exact: true }).first().click();
    const listRow = page.locator('[data-testid^="plan-listrow-"]').first();
    await listRow.waitFor({ timeout: 20_000 });
    await listRow.click();
    await opened(before);
  } finally {
    await k.close();
  }
});

// A bar is dragged with the mouse: the menu's own pointer-down (a finger held still opens the menu) was spread over the bar's, so on the web a bar never began a drag at all.
test("a bar is dragged by the mouse on a computer: its dates move, and the task does not open", async (t) => {
  const k = await bootNav({ width: 1280, height: 900, scheme: "light", tag: "desktop-plan-drag" });
  if (!k) {
    t.skip("VYRE_APP_DIST required");
    return;
  }
  const { page, api } = k;
  try {
    const me = (await page.evaluate(
      `JSON.parse(localStorage.getItem("vyre.session.v1")).sessions[location.origin].personId`,
    )) as string;
    const project = (await api("projects.create", {
      type: "project",
      title: "Drag proof",
      idempotencyKey: "r41-drag-proj",
    })) as {
      projectId: string;
      recordId: string;
    };
    await api("projects.stages.set", {
      projectId: project.projectId,
      stages: [{ title: "To do" }],
      idempotencyKey: "r41-drag-stages",
    });
    const day = 86_400_000;
    const start = Math.floor(Date.now() / day) * day + 3 * day;
    await api("tasks.create", {
      title: "Move me",
      assigned: { kind: "person", id: me },
      recordId: project.recordId,
      start,
      due: start + 2 * day,
      idempotencyKey: "r41-drag-task",
    });
    const startOf = async (): Promise<number> =>
      ((await api("projects.plan", { projectId: project.projectId })) as { tasks: { start?: number }[] }).tasks[0]!
        .start!;
    const was = await startOf();
    await page.goto(`${page.url().split("#")[0].split("?")[0]}#subject=project:${project.projectId}`, {
      waitUntil: "load",
    });
    await page.reload({ waitUntil: "load" });
    await page.getByTestId("tabname-plan").click();
    const bar = page.locator('[data-testid^="plan-bar-"]').first();
    await bar.waitFor({ timeout: 20_000 });
    const box = (await bar.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.waitForFunction(`true`, null, { timeout: 1000 });
    let now = was;
    for (let i = 0; i < 20 && now === was; i++) {
      await page.waitForTimeout(500);
      now = await startOf();
    }
    assert.notEqual(now, was, "the bar's dates moved");
  } finally {
    await k.close();
  }
});
