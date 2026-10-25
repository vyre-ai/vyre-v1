// The tray (Windows, Linux) and menu-bar (Mac) icon: one model the shell draws from. Spec 2.24: the count is Needs you only, never a pile of kinds.

import { badgeText } from "./notify.ts";

export type SidecarPhase = "starting" | "ready" | "failed" | "stopped";
export type TrayState = { windowVisible: boolean; needsYou: number; sidecar: SidecarPhase; version?: string };
export type TrayItem = { id: "open" | "needs" | "status" | "quit" | "sep"; label: string; enabled: boolean };
export type TrayModel = { tooltip: string; badge: string; items: TrayItem[] };

export const TRAY_IDS = ["open", "needs", "status", "quit"] as const;

const STATUS: Record<SidecarPhase, string> = { starting: "Starting", ready: "Running", failed: "Not running", stopped: "Stopped" };

export function trayModel(s: TrayState): TrayModel {
  const n = Number.isFinite(s.needsYou) && s.needsYou > 0 ? Math.floor(s.needsYou) : 0;
  return {
    tooltip: n > 0 ? `Vyre, ${n} ${n === 1 ? "thing needs" : "things need"} you` : "Vyre",
    badge: badgeText(n),
    items: [
      { id: "open", label: s.windowVisible ? "Hide Vyre" : "Open Vyre", enabled: true },
      { id: "needs", label: n > 0 ? `Needs you (${n})` : "Needs you", enabled: n > 0 },
      { id: "sep", label: "", enabled: false },
      { id: "status", label: `Vyre on this computer: ${STATUS[s.sidecar]}${s.version && s.sidecar === "ready" ? ` (${s.version})` : ""}`, enabled: false },
      { id: "quit", label: "Quit Vyre", enabled: true },
    ],
  };
}

/** What a click on a tray item does. "needs-you" brings the window forward and tells the page (event vyre://tray) to open Needs you. */
export function trayAction(id: string): "toggle" | "needs-you" | "quit" | "none" {
  if (id === "open") return "toggle";
  if (id === "needs") return "needs-you";
  if (id === "quit") return "quit";
  return "none";
}
