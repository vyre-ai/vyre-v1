// Mounts Report a problem in the signed-in shell: one controller over this session's capability caller, the sheet, and the hooks (the menu's last item, Cmd-Shift-/, and the
// "Report a problem" button on an error panel, which raises "vyre:report-problem" with the failed action's trace id).
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import type { CapCall } from "../session/caps.ts";
import { ReportController } from "./controller.ts";
import type { ReportDeps } from "./controller.ts";
import { ReportSheet } from "./ReportSheet.tsx";
import { installReport } from "./install.ts";
import { createMemoryOutbox } from "./outbox.ts";
import { captures } from "./ring.ts";
import { PLACE_NAMES } from "./sample.ts";

const keyOf = (): string => { const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto; return c?.randomUUID ? c.randomUUID() : `k_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`; };
const deviceLine = (): string => { const n = (globalThis as { navigator?: { platform?: string; userAgent?: string } }).navigator; return `${n?.platform ?? "device"} · ${(n?.userAgent ?? "").match(/(Chrome|Safari|Firefox)\/[\d.]+/)?.[0] ?? "app"}`.slice(0, 80); };

export function ReportHost({ call, place }: { call: CapCall; place: string }): ReactElement | null {
  const placeRef = useRef(place);
  placeRef.current = place;
  const [online, setOnline] = useState(true);
  const policy = useRef<"on" | "ask" | "off">("ask");
  const controller = useMemo(() => {
    const deps: ReportDeps = {
      snapshot: () => captures.snapshot(),
      versions: () => ({ app: "web", server: "space", device: deviceLine() }),
      online: () => (globalThis as { navigator?: { onLine?: boolean } }).navigator?.onLine !== false,
      policy: () => policy.current,
      submit: async (input) => (await call("reports.submit", input)) as { reportId: string; taskId: string; sentToVyre: boolean },
      sendToVyre: async (reportId) => { const out = (await call("reports.send_to_vyre", { reportId, idempotencyKey: keyOf() })) as { issueNumber?: number }; return out.issueNumber === undefined ? {} : { issueNumber: out.issueNumber }; },
      placeName: (p) => PLACE_NAMES[p] ?? p,
      outbox: createMemoryOutbox(),
    };
    return new ReportController(deps);
  }, [call]);
  useEffect(() => {
    let off = false;
    void (call("reports.policy_get", {}) as Promise<{ policy: "on" | "ask" | "off" }>).then((r) => { if (!off) policy.current = r.policy; }).catch(() => undefined);
    return () => { off = true; };
  }, [call]);
  useEffect(() => installReport(controller, { currentPlace: () => placeRef.current, platform: /mac/i.test((globalThis as { navigator?: { platform?: string } }).navigator?.platform ?? "") ? "mac" : "other" }), [controller]);
  useEffect(() => {
    const g = globalThis as { addEventListener?: (t: string, f: () => void) => void; removeEventListener?: (t: string, f: () => void) => void };
    const up = (): void => setOnline(true), down = (): void => setOnline(false);
    g.addEventListener?.("online", up); g.addEventListener?.("offline", down);
    return () => { g.removeEventListener?.("online", up); g.removeEventListener?.("offline", down); };
  }, []);
  return <ReportSheet controller={controller} online={online} />;
}
