// Helper for the r32-nav row-menu walks (not a walk): every place's rows have Open in New Tab in their right-click menu, and the keyboard reaches the menu (Shift+F10, the Menu key). Two walks share it so each stays short.
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { bootNav } from "./r32-nav-kit.test.ts";
import type { Pg } from "./r32-nav-kit.test.ts";

const tabNames = (page: Pg): Promise<string[]> =>
  page.evaluate(() =>
    [...(document.querySelector('[data-testid="tab-strip"]')?.querySelectorAll('[role="tab"]') ?? [])].map(
      (e) => e.getAttribute("aria-label") ?? "",
    ),
  );

export async function rowMenuWalk(t: TestContext, places: readonly string[], tag: string): Promise<void> {
  const k = await bootNav({ width: 1440, height: 900, scheme: "dark", tag });
  if (!k) {
    t.skip("VYRE_APP_DIST required");
    return;
  }
  const { page, api, say, shot } = k;
  try {
    const assistant = (await api("agents.list", {})).agents[0] as { agentId: string };
    const root = JSON.stringify(await api("files.tree", {})).match(/"(fld_[a-z0-9]+)"/)![1]!;
    const folder = (await api("files.folder.create", { parentId: root, name: "Contracts" })).folder.folderId as string;
    const made = await api("files.create", {
      folderId: folder,
      name: "Engagement letter.md",
      content: { text: "Dear client" },
    });
    const fileId = JSON.stringify(made).match(/"(fil_[a-z0-9]+)"/)![1]!;
    const auto = (await api("automations.create", { name: "Weekly digest" })).automation as { id: string };
    await api("chat.start", { kind: "chat", agentIds: [assistant.agentId], first: "hello" });
    say(`seeded ${fileId} ${auto.id}`);

    const place = async (name: string): Promise<void> => {
      // the rail's tiles can sit under the rail's own track at this height: press them from the page
      await page
        .getByTestId(`rail-${name}`)
        .or(page.getByTestId(`rail-${name}-selected`))
        .first()
        .evaluate((el) => (el as HTMLElement).click());
      await page.waitForTimeout(1800);
    };
    const rowIn = (sel: string, text?: RegExp) => {
      let l = page.locator(`${sel}:not([data-testid$="-leading"]):not([data-testid$="-trailing"])`);
      if (text) l = l.filter({ hasText: text });
      return l.first();
    };
    // [place, how to find a row]
    const cases: [string, () => ReturnType<typeof rowIn>][] = [
      ["chats", () => rowIn('[data-testid^="row"]', /Engagement|See|chat/i)],
      [
        "files",
        () =>
          page
            .locator('[data-testid^="row-line:folder:"]:not([data-testid$="-leading"]):not([data-testid$="-trailing"])')
            .first(),
      ],
      ["records", () => rowIn('[data-testid^="row-nav:type:"]')],
      ["automations", () => rowIn('[data-testid^="row-auto-"]')],
      ["console", () => page.getByTestId("row-nav-space").or(page.getByTestId("row-nav-people")).first()],
      ["settings", () => page.getByTestId("row-page-appearance")],
      ["vault", () => page.getByTestId("row-nav-logins")],
      ["inbox", () => page.getByTestId("row-nav:view:thread")],
    ];
    for (const [name, row] of cases) {
      if (!places.includes(name)) continue;
      await place(name);
      const r = row();
      await r.waitFor({ timeout: 15_000 }).catch(async (e) => {
        say(
          `${name}: no row; ids ${await page.evaluate(() =>
            [...document.querySelectorAll("[data-testid]")]
              .map((x) => x.getAttribute("data-testid"))
              .filter((x) => /row|nav|tree|folder/.test(x ?? ""))
              .slice(0, 40)
              .join(","),
          )}`,
        );
        await shot(`no-row-${name}`);
        throw e;
      });
      const before = (await tabNames(page)).length;
      await r.click({ button: "right" });
      await page.waitForTimeout(800);
      const seen = await page.getByRole("menuitem").allInnerTexts();
      say(`${name}: row ${await r.getAttribute("data-testid")} menu [${seen.join(" | ").replace(/\s+/g, " ")}]`);
      const item = page.getByRole("menuitem", { name: /Open in (a )?new tab/i });
      await item.waitFor({ timeout: 5_000 });
      if (name === "settings" || name === "vault") await shot(`menu-${name}`);
      await item.click();
      await page.waitForTimeout(1500);
      const after = await tabNames(page);
      say(`${name}: tabs ${before} -> ${after.length} (${after.join(" | ")})`);
      assert.equal(after.length, before + 1, `${name}: Open in New Tab made a tab`);
      // the keyboard reaches the same menu
      await place(name);
      const r2 = row();
      await r2.focus();
      await page.keyboard.press("Shift+F10");
      await page.getByRole("menuitem", { name: /Open in (a )?new tab/i }).waitFor({ timeout: 5_000 });
      await page.keyboard.press("Escape");
      await r2.focus();
      await page.keyboard.press("ContextMenu");
      await page.getByRole("menuitem", { name: /Open in (a )?new tab/i }).waitFor({ timeout: 5_000 });
      await page.keyboard.press("Escape");
    }
  } finally {
    await k.close();
  }
}
