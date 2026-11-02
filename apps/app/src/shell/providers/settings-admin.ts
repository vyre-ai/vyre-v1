// The Console's pages are the Console's: who may open which, and the address of one from anywhere in the app.
import { PAGES as CONSOLE_PAGES } from "../../console/shell/nav.ts";

/** The Console page ids this person may open, from console.nav. A screen can open more than one id. */
export function adminPages(out: { groups: Array<{ pages: Array<{ key: string }> }> }): ReadonlySet<string> {
  const screens = new Set(out.groups.flatMap((group) => group.pages.map((page) => page.key)));
  return new Set(CONSOLE_PAGES.filter((page) => screens.has(page.screen)).map((page) => page.id));
}

/** The address of a Console screen. */
export function adminTarget(screen: string, args: Record<string, string> = {}): { screen: string; args: Record<string, string> } {
  const id = CONSOLE_PAGES.find((page) => page.screen === screen)?.id;
  return { screen, args: id ? { page: id, ...args } : args };
}
