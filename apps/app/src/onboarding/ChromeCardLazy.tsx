// The Chrome card of the onboarding screen, loaded when the card is drawn (r40): the card pulls in the Vault's providers and layout (about half a megabyte of source), and the onboarding host that holds it
// is part of every signed-in shell, whether or not onboarding is on screen.
import { Suspense } from "react";
import { lazyPart } from "../../../../ui/src/Lazy/index.tsx";
import type { ComponentProps, ReactElement } from "react";
import type { ChromeCard as ChromeCardView } from "./ChromeCard.tsx";

const Card = lazyPart(() => import("./ChromeCard.tsx").then((m) => ({ default: m.ChromeCard })));

export function ChromeCard(props: ComponentProps<typeof ChromeCardView>): ReactElement {
  return (
    <Suspense fallback={null}>
      <Card {...props} />
    </Suspense>
  );
}
