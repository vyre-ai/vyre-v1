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
