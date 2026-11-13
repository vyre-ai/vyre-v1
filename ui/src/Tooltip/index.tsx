// ui/Tooltip: the one tooltip on whatever it wraps (see tips.ts: hover or keyboard focus after 350 ms, gone on blur, Escape, scroll and press). The wrapper takes no box of its own (display: contents),
// so a flex row lays out exactly as it did without it. Off the web it draws the children as they are.
//   text   one or two lines ("Name" then "Who it is", separated by a new line)
//   cut    the tip is for a name that may be cut by an ellipsis: it shows only when the text really is cut
//   open   the caller decides (a list whose cursor is a row, with focus staying in the list): true shows it, false puts it away
import { createElement, useEffect, useRef } from "react";
import type { ReactElement } from "react";
import { Platform } from "react-native";
import { hideTip, showTip } from "./tips.ts";
import type { TipEl } from "./tips.ts";

export function Tooltip({
  text,
  children,
  cut = false,
  open,
}: {
  text: string;
  children: ReactElement;
  cut?: boolean;
  open?: boolean;
}): ReactElement {
  const ref = useRef<TipEl | null>(null);
  useEffect(() => {
    if (open === undefined || !ref.current) return undefined;
    if (open) showTip(ref.current, text);
    else hideTip();
    return () => hideTip();
  }, [open, text]);
  if (Platform.OS !== "web" || text === "") return children;
  return createElement(
    "div",
    { ref, title: text, ...(cut ? { "data-tt-cut": "1" } : {}), style: { display: "contents" } },
    children,
  );
}
