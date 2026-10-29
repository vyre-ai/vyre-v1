// The root route for the static export: one page per route (index, [place], claim, join) so deep links and the daemon serve a page, each drawing the app root.
// In the browser the app does not run through the router: index.web.tsx hydrates this same root directly (src/startup/AppRoot.tsx).
import type { ReactElement } from "react";
import { AppRoot } from "../src/startup/AppRoot.tsx";

export default function Layout(): ReactElement {
  return <AppRoot />;
}
