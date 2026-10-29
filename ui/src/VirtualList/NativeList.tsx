import type { ReactElement } from "react";
import type { VirtualListProps } from "./props.ts";

/** Web never calls this branch; Metro resolves NativeList.native.tsx for iOS and Android. */
export function NativeList<T>(_props: VirtualListProps<T>): ReactElement | null {
  return null;
}
