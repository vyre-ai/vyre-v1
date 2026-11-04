// A mount draws after the page has hydrated. The shots app is exported as static pages: the server draws each mount once with a default window, and the browser then hydrates it at its own size, so a
// mount whose first frame depends on the window (a wide layout, a phone layout) differed from the page it hydrated (React error 418). Children appear after mount, so the server's page and the
// browser's first frame are the same one: empty.
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

export function ClientOnly({ children }: { children: ReactNode }): ReactNode {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return ready ? children : null;
}
