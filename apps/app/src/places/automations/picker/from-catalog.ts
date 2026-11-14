// The picker's input from the step list the server answered. The server already left out the apps this person may not use (automations.steps.list), so every app that appears here is connected and usable:
// nothing is decided again on this side. An app's name is not repeated in each of its actions.
import type { CatalogStep } from "../catalog/model.ts";
import { appOfStep } from "./model.ts";
import type { PickApp, PickIn, PickStep } from "./model.ts";

const NAMES: Readonly<Record<string, string>> = {
  google: "Google Workspace",
  microsoft: "Microsoft 365",
  github: "GitHub",
};

const stripApp = (title: string): string => title.replace(/^[^:·]{1,40}\s*[:·]\s+/, "");

export function pickInFromCatalog(
  steps: readonly CatalogStep[],
  suggested: readonly string[] = [],
  suggestedFrom?: string,
): PickIn {
  const apps = new Map<string, PickApp>();
  const out: PickStep[] = steps.map((s) => {
    const preset = s.preset as NonNullable<PickStep["preset"]> | undefined;
    const step: PickStep = preset ? { key: s.key, title: s.title, preset } : { key: s.key, title: s.title };
    const app = appOfStep(step);
    if (app === null) return step;
    if (!apps.has(app)) {
      const fromTitle = s.title.split(/\s*[:·]\s+/)[0] ?? app;
      apps.set(app, {
        id: app,
        name: NAMES[app] ?? (fromTitle.length > 0 ? fromTitle : app),
        connected: true,
        mayUse: true,
      });
    }
    return { ...step, title: stripApp(s.title) };
  });
  return { steps: out, apps: [...apps.values()], suggested, ...(suggestedFrom ? { suggestedFrom } : {}) };
}
