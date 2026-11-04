// ui/Row for a row that opens a thing: it asks the link policy (ui/reach) how to draw. A live row is a Row; a peek row is a Row with a lock on hover and a "Shows a summary" hover that opens the
// peek; a row the person cannot open is plain text, no pointer and no hover paint. Everything else about the row is Row's.
import { createElement } from "react";
import type { ReactElement } from "react";
import { useLinkState } from "../reach/index.tsx";
import type { LinkSubject } from "../reach/index.tsx";
import { useLinkPolicy } from "../reach/index.tsx";
import { Row } from "./index.tsx";
import type { RowProps } from "./props.ts";

export function ReachRow({ subject, onPress, ...rest }: RowProps & { subject?: LinkSubject | undefined }): ReactElement {
  const link = useLinkState(subject);
  const policy = useLinkPolicy();
  if (link.state === "plain") return createElement(Row, { ...rest, inert: true });
  if (link.state === "peek" && subject !== undefined) return createElement(Row, { ...rest, locked: true, ...(link.hint ? { hint: link.hint } : {}), onPress: () => policy?.peek(subject) });
  return createElement(Row, { ...rest, ...(onPress ? { onPress } : {}) });
}
