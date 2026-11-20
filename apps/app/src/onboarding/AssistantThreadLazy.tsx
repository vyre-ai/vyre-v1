// The Assistant's thread inside the onboarding screen, loaded when the screen draws it (r40): it pulls the whole Chats data layer, and the onboarding host that holds it is part of every signed-in shell.
import { Suspense } from "react";
import { lazyPart } from "../../../../ui/src/Lazy/index.tsx";
import type { ComponentProps, ReactElement } from "react";
import type { AssistantThread as AssistantThreadView } from "./AssistantThread.tsx";

const Thread = lazyPart(() => import("./AssistantThread.tsx").then((m) => ({ default: m.AssistantThread })));

export function AssistantThread(props: ComponentProps<typeof AssistantThreadView>): ReactElement {
  return (
    <Suspense fallback={null}>
      <Thread {...props} />
    </Suspense>
  );
}
