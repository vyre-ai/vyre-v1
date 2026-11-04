import { Slot } from "expo-router";
import { useMemo } from "react";
import { setShotFaces } from "../../../../ui/src/Avatar/assistant.ts";
import { formatFace, PER_FAMILY, DRAWN, TINTS } from "../../../../ui/src/Avatar/agentface.ts";

// ?faces=1 on any mount: sample agents that have no stored face wear library faces (one of each family in turn) and some show a state, so a place's faces can be looked at (lane l-artifacts).
function hashOf(s: string): number { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }
function wear(): void {
  if (typeof location === "undefined" || !/[?&]faces=1(&|$)/.test(location.search)) return;
  setShotFaces(
    (id) => { const h = hashOf(id); const fam = DRAWN[h % DRAWN.length]!; return formatFace({ fam, i: (h >>> 3) % PER_FAMILY, tint: (h >>> 7) % TINTS.length }); },
    (id) => { const h = hashOf(id) % 6; return h === 0 ? "working" : h === 1 ? "asleep" : h === 2 ? "done" : ""; },
  );
}

export default function Layout() {
  useMemo(wear, []);
  return <Slot />;
}
