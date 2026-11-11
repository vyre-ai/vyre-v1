// @tsx
// Records sharing on a phone in the real app (DESIGN-records-sharing): each person in their own 390 wide browser from the start: Records from the tab bar, Share, read only, nothing for Dee. The desktop steps are records.sharing.live.test.ts; the Space is in records-sharing-kit.ts.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { OUT, recordsSharingSpace } from "./records-sharing-kit.ts";

test("records sharing on a phone: Records from the tab bar, Share, read only, nothing for Dee", async (t) => {
  await recordsSharingSpace(t, async ({ t, ada, cal, dee, deals, deal, api, open }) => {
    const count = (page: any, id: string): Promise<number> => page.getByTestId(id).count();   // eslint-disable-line @typescript-eslint/no-explicit-any
    await t.test("10 on a phone, each person in their own 390 wide browser from the start: Records from the tab bar, Share, read only, nothing for Dee", async () => {
      // the state first: Deals is Only people added, Bea edits, Cal views with no export
      await api(ada, "access.audience_set", { resource: deal, audience: "added" });
      await api(ada, "access.share", { resource: deal, subject: { kind: "person", id: cal.id }, level: "view", export: false });
      const PA = await open(ada, true), PC = await open(cal, true), PD = await open(dee, true);
      let n = 0;
      const look = async (page: any, name: string): Promise<void> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
        n++;
        for (const mode of ["light", "dark"] as const) {
          await page.emulateMedia({ colorScheme: mode });
          await page.waitForTimeout(400);
          await page.screenshot({ path: path.join(OUT, `phone-${String(n).padStart(2, "0")}-${name}-${mode}.png`) });
        }
        await page.emulateMedia({ colorScheme: "light" });
      };
      const toRecords = async (page: any): Promise<void> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
        await page.getByRole("tab", { name: /Records/ }).click();
        await page.getByTestId("records-place").waitFor({ timeout: 20_000 });
      };
      const toDealsOnPhone = async (page: any): Promise<void> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
        await toRecords(page);
        await page.getByTestId(`list-${deals["Acme renewal"]}`).waitFor({ timeout: 20_000 });
      };
      const more = async (page: any): Promise<void> => { await page.getByTestId("records-more").click(); };   // eslint-disable-line @typescript-eslint/no-explicit-any
      // Ada: Share and Export are in the More menu on a phone
      await toDealsOnPhone(PA);
      await look(PA, "ada-deals");
      await more(PA);
      await PA.getByText("Export as CSV", { exact: true }).waitFor({ timeout: 15_000 });
      await look(PA, "ada-more-menu");
      await PA.getByText("Share", { exact: true }).first().click();
      await PA.getByTestId("records-share").waitFor();
      assert.equal(await PA.getByTestId("as-audience-pick-added").getAttribute("aria-selected"), "true");
      await look(PA, "ada-sheet-people-added");
      await PA.getByTestId(`as-export-${cal.id}`).click();
      await PA.waitForFunction((id: string) => document.querySelector(`[data-testid="as-export-${id}"]`)?.getAttribute("aria-checked") === "true", cal.id);
      await look(PA, "ada-export-on-for-cal");
      await PA.getByTestId("as-more").click();
      await look(PA, "ada-export-setting-menu");
      await PA.keyboard.press("Escape");
      // Cal: Export but no Share, and the deal reads only
      await toDealsOnPhone(PC);
      await more(PC);
      await PC.getByText("Export as CSV", { exact: true }).waitFor({ timeout: 20_000 });
      assert.equal(await PC.getByText("Share", { exact: true }).count(), 0, "no Share for a viewer");
      await look(PC, "cal-more-with-export");
      await PC.keyboard.press("Escape");
      await PC.getByTestId(`list-${deals["Birch lease"]}`).click();
      await PC.getByTestId("record-readonly").waitFor({ timeout: 20_000 });
      await look(PC, "cal-record-read-only");
      // Dee: nothing
      await toRecords(PD);
      await PD.waitForTimeout(800);
      assert.equal(await count(PD, "row-nav:type:rt_deal"), 0);
      assert.equal(await PD.getByText("Deals", { exact: true }).count(), 0, "no Deals for Dee");
      await look(PD, "dee-no-deals");
    });

  });
});
