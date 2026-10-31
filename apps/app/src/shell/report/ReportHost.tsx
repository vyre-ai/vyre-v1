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

/**
 * `call` is null while the session is not open (the Space could not be reached): the sheet still opens from an error panel, and a report is queued until the session is back.
 * The controller is made once, so a queued report survives the session opening.
 */
export function ReportHost({ call, place }: { call: CapCall | null; place: string }): ReactElement | null {
  const callRef = useRef(call);
  callRef.current = call;
  const placeRef = useRef(place);
  placeRef.current = place;
  const [online, setOnline] = useState(true);
  const [, tick] = useState(0);
  const policy = useRef<"on" | "ask" | "off">("ask");
  const controller = useMemo(() => {
    const deps: ReportDeps = {
      snapshot: () => captures.snapshot(),
      versions: () => ({ app: "web", server: "space", device: deviceLine() }),
      online: () => callRef.current !== null && (globalThis as { navigator?: { onLine?: boolean } }).navigator?.onLine !== false,
      policy: () => policy.current,
      submit: async (input) => { const c = callRef.current; if (!c) throw new Error("not connected"); return (await c("reports.submit", input)) as { reportId: string; taskId: string; sentToVyre: boolean }; },
      sendToVyre: async (reportId) => { const c = callRef.current; if (!c) throw new Error("not connected"); const out = (await c("reports.send_to_vyre", { reportId, idempotencyKey: keyOf() })) as { issueNumber?: number }; return out.issueNumber === undefined ? {} : { issueNumber: out.issueNumber }; },
      placeName: (p) => PLACE_NAMES[p] ?? p,
      outbox: createMemoryOutbox(),
    };
    return new ReportController(deps);
  }, []);
  useEffect(() => {
    if (!call) return undefined;
    tick((n) => n + 1);
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
  return <ReportSheet controller={controller} online={online && call !== null} />;
}
