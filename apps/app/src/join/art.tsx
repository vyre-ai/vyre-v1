// The pictures on the doors and cards of the first screens: duotone line art, the accent doing the talking. One viewBox, drawn in the ink with accent touches; skin tokens (CSS variables), so a skin
// or light/dark switch repaints with no re-render. Web draws the SVG; native shows nothing (the title carries the choice).
import { createElement } from "react";
import type { ReactElement } from "react";
import { Platform } from "react-native";
import { useJoin } from "./kit.tsx";

export type ArtKind = "me" | "invited" | "team" | "join" | "server" | "mac" | "pc" | "app" | "mail";

const BODY: Record<ArtKind, string> = {
  me: '<circle cx="66" cy="58" r="46" fill="{{wash}}" stroke="none"/><circle cx="66" cy="46" r="15"/><path d="M36 92c3-17 16-26 30-26s27 9 30 26"/><rect x="86" y="68" width="28" height="24" rx="7" fill="{{raised}}" stroke="{{accent}}"/><path d="M92 68v-6a8 8 0 0116 0v6" stroke="{{accent}}"/><circle cx="100" cy="80" r="2.600" fill="{{accent}}" stroke="none"/>',
  invited: '<circle cx="66" cy="58" r="46" fill="{{wash}}" stroke="none"/><rect x="24" y="36" width="84" height="58" rx="11" fill="{{raised}}"/><path d="M28 44l38 28 38-28"/><circle cx="104" cy="34" r="12" fill="{{accent}}" stroke="none"/><path d="M98.500 34l3.800 3.800 7-7" stroke="{{accentInk}}" stroke-width="2.600"/>',
  team: '<circle cx="66" cy="58" r="46" fill="{{wash}}" stroke="none"/><circle cx="66" cy="42" r="12"/><path d="M42 90c2-15 12-22 24-22s22 7 24 22"/><circle cx="30" cy="54" r="8" stroke="{{accent}}"/><path d="M16 88c1-10 7-15 14-15" stroke="{{accent}}"/><circle cx="102" cy="54" r="8" stroke="{{accent}}"/><path d="M116 88c-1-10-7-15-14-15" stroke="{{accent}}"/>',
  join: '<circle cx="66" cy="58" r="46" fill="{{wash}}" stroke="none"/><rect x="24" y="36" width="84" height="58" rx="11" fill="{{raised}}"/><path d="M28 44l38 28 38-28"/><circle cx="104" cy="34" r="12" fill="{{accent}}" stroke="none"/><path d="M98.500 34l3.800 3.800 7-7" stroke="{{accentInk}}" stroke-width="2.600"/>',
  server: '<circle cx="66" cy="58" r="46" fill="{{wash}}" stroke="none"/><rect x="28" y="30" width="76" height="26" rx="9" fill="{{raised}}"/><rect x="28" y="62" width="76" height="26" rx="9" fill="{{raised}}"/><circle cx="42" cy="43" r="3" fill="{{accent}}" stroke="none"/><circle cx="42" cy="75" r="3" fill="{{accent}}" stroke="none"/><path d="M60 43h30M60 75h30" stroke-opacity=".5"/>',
  mac: '<circle cx="66" cy="58" r="46" fill="{{wash}}" stroke="none"/><rect x="30" y="32" width="72" height="48" rx="9" fill="{{raised}}"/><path d="M20 92h92" /><circle cx="66" cy="56" r="6" stroke="{{accent}}"/>',
  pc: '<circle cx="66" cy="58" r="46" fill="{{wash}}" stroke="none"/><rect x="26" y="30" width="80" height="52" rx="9" fill="{{raised}}"/><path d="M52 94h28M66 82v12"/><path d="M60 50h12M66 44v12" stroke="{{accent}}"/>',
  app: '<circle cx="66" cy="58" r="46" fill="{{wash}}" stroke="none"/><rect x="38" y="24" width="56" height="64" rx="14" fill="{{raised}}"/><path d="M66 40v26M54 56l12 12 12-12" stroke="{{accent}}"/><path d="M52 78h28"/>',
  mail: '<circle cx="66" cy="58" r="46" fill="{{wash}}" stroke="none"/><rect x="24" y="36" width="84" height="58" rx="11" fill="{{raised}}"/><path d="M28 44l38 28 38-28"/>',
};

export function Art({ kind, width = 132, height = 112, color }: { kind: ArtKind; width?: number; height?: number; color?: string }): ReactElement | null {
  const { p } = useJoin();
  if (Platform.OS !== "web") return null;
  const html = BODY[kind].replaceAll("{{wash}}", p.accentWash).replaceAll("{{raised}}", p.panel).replaceAll("{{accentInk}}", p.accentInk).replaceAll("{{accent}}", p.blue);
  return createElement("svg", {
    viewBox: "0 0 132 112", width, height, fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true,
    style: { color: color ?? p.tx, display: "block", flex: "none" }, dangerouslySetInnerHTML: { __html: html },
  });
}
