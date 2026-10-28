// Plan is optional on both Home (List is the default) and a Project (Overview
// is the default). One shared dynamic boundary keeps its editor out of the
// production common chunk while preserving the full surface when selected.
import { lazy, Suspense } from "react";
import type { ReactElement } from "react";
import { View } from "react-native";
import type { PlanProps } from "./types.ts";

const FullPlan = lazy(() => import("./index.tsx").then((m) => ({ default: m.Plan })));

export function DeferredPlan(props: PlanProps): ReactElement {
  return (
    <Suspense fallback={<View testID="plan-loading" accessibilityLabel="Loading the plan" style={{ height: props.height ?? 340, backgroundColor: "var(--sunk)" as string }} />}>
      <FullPlan {...props} />
    </Suspense>
  );
}
