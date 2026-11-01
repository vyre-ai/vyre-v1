// The Console's pages live inside Settings. This says who may open which, and turns a Console address from inside the app into the Settings page that holds it.
import { PAGES as CONSOLE_PAGES } from "../../console/shell/nav.ts";
import { adminHome } from "../../places/settings/model.ts";

/** The Console page ids this person may open, from console.nav. `export` shares the Backups screen, so a screen can open more than one id. */
export function adminPages(out: { groups: Array<{ pages: Array<{ key: string }> }> }): ReadonlySet<string> {
  const screens = new Set(out.groups.flatMap((group) => group.pages.map((page) => page.key)));
  return new Set(CONSOLE_PAGES.filter((page) => screens.has(page.screen)).map((page) => page.id));
}

/** The registry screens behind those ids, which is what a Console page checks. */
export function consoleScreens(pages: ReadonlySet<string>): ReadonlySet<string> {
  return new Set(CONSOLE_PAGES.filter((page) => pages.has(page.id)).map((page) => page.screen));
}

/** The Settings address of a Console screen, or the screen as given when nothing in Settings holds it. */
export function adminTarget(screen: string, args: Record<string, string> = {}): { screen: string; args?: Record<string, string> } {
  const id = CONSOLE_PAGES.find((page) => page.screen === screen)?.id;
  const home = id ? adminHome(id) : null;
  return home && id ? { screen: "settings.page", args: { page: home.page, admin: id, ...args } } : { screen, args };
}
