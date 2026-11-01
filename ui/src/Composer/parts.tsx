// Small pieces of the composer (rc.8): the brand mark of a provider, effort bars, the context ring, the working light, the popover frame and its group heads, and the stylesheet
// the few animations need. Colours are skin tokens, so light and dark (and every skin) repaint with no re-render.
import { createElement, useEffect, useRef } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import type { ViewStyle } from "react-native";
import { BRANDS } from "../AppIcon/brands.ts";
import { markKey } from "../AppIcon/domains.ts";
import { injectCss } from "../theme/css.ts";
import { effortBars } from "./brain.ts";
import type { Effort } from "./brain.ts";

const web = Platform.OS === "web";
export const webOnly = (props: Record<string, unknown>): Record<string, unknown> => (web ? props : {});

/* ---------- one stylesheet for what inline styles cannot do ---------- */

let cssDone = false;
/** The working light's sweep, the popover's arrival, the drop outline and the hover reveal of a tray card's remove button. Added once, through the sheet (CSP safe). */
export function ensureComposerCss(): void {
  if (cssDone || !web) return;
  const d = (globalThis as { document?: Parameters<typeof injectCss>[0] }).document;
  if (!d || !d.head) return;
  injectCss(d, "vyre-ui-composer", [
    "@keyframes vyre-cmp-sweep{0%{background-position:-40% 0}100%{background-position:140% 0}}",
    "@keyframes vyre-cmp-in{from{opacity:0;transform:translateY(6px) scale(.985)}to{opacity:1;transform:none}}",
    "[data-cmp-light]{background:linear-gradient(90deg,transparent,var(--accent),transparent);background-size:40% 100%;background-repeat:no-repeat;animation:vyre-cmp-sweep 1.4s ease-in-out infinite}",
    "[data-cmp-pop]{animation:vyre-cmp-in .14s ease-out}",
    "[data-cmp-card] [data-cmp-rm]{opacity:0;transition:opacity .12s}",
    "[data-cmp-card]:hover [data-cmp-rm]{opacity:1}",
    "@media (hover:none){[data-cmp-card] [data-cmp-rm]{opacity:1}}",
    "[data-cmp-field] textarea::placeholder{color:var(--ink-4)}",
    "[data-cmp-focus]{border-color:color-mix(in srgb,var(--accent) 45%,var(--line-2)) !important}",
    "[data-cmp-low]{background-color:color-mix(in srgb,var(--warn) 14%,transparent)}",
  ].join("\n"));
  cssDone = true;
}

/* ---------- closing a popover ---------- */

type DomNode = { contains?: (n: unknown) => boolean } | null;
/** Web: a press outside the given nodes, or Escape, closes the popover. The nodes are read when the press happens, so refs set after the first paint still count. */
export function useDismiss(open: boolean, close: () => void, inside: () => readonly DomNode[]): void {
  const cb = useRef({ close, inside });
  cb.current = { close, inside };
  useEffect(() => {
    if (!open || !web) return undefined;
    const doc = (globalThis as { document?: { addEventListener?: (t: string, f: (e: never) => void, c?: boolean) => void; removeEventListener?: (t: string, f: (e: never) => void, c?: boolean) => void } }).document;
    if (!doc?.addEventListener) return undefined;
    const down = (e: { target?: unknown }): void => {
      for (const n of cb.current.inside()) if (n?.contains?.(e.target)) return;
      cb.current.close();
    };
    const key = (e: { key?: string; defaultPrevented?: boolean }): void => { if (e.key === "Escape" && !e.defaultPrevented) cb.current.close(); };
    doc.addEventListener("mousedown", down as never, true);
    doc.addEventListener("keydown", key as never);
    return () => { doc.removeEventListener?.("mousedown", down as never, true); doc.removeEventListener?.("keydown", key as never); };
  }, [open]);
}

/* ---------- brand marks ---------- */

const PROVIDER_BRAND: Record<string, string> = {
  anthropic: "claude", claude: "claude", claude_code: "claude", "claude-code": "claude",
  openai: "openai", codex: "openai", chatgpt: "openai",
  grok: "grok", xai: "grok",
  google: "googlegemini", gemini: "googlegemini", openrouter: "openrouter", local: "localmodel", opencode_go: "opencode", opencode: "opencode",
  gmail: "gmail", google_mail: "gmail", outlook: "microsoft", microsoft: "microsoft", office365: "microsoft", mailgun: "mailgun", resend: "resend", twilio: "twilio",
};

/** The brand key for a provider, driver or mail service id, or null for one without a mark. */
export function brandOf(provider: string | undefined): string | null {
  if (!provider) return null;
  const k = PROVIDER_BRAND[provider.toLowerCase()] ?? provider.toLowerCase();
  return markKey(k);
}

/** A provider's mark alone (no tile), in its own colour; nothing for one without a mark. */
export function BrandMark({ provider, size = 13 }: { provider: string | undefined; size?: number }): ReactElement | null {
  const key = brandOf(provider);
  const mark = key ? BRANDS[key] : undefined;
  if (!key || !mark || !web) return null;
  return createElement("svg", {
    viewBox: "0 0 24 24", width: size, height: size, "aria-hidden": true, fill: "currentColor", "data-brand": key,
    style: { color: mark.c ?? "var(--ink)", display: "block", flex: "none" },
    dangerouslySetInnerHTML: { __html: mark.svg ?? `<path d="${mark.p ?? ""}"/>` },
  });
}

/** A sender's or account's logo on a small tile: the brand mark, or the first letter of the service on a quiet tile. */
export function LogoTile({ provider, name, size = 22 }: { provider: string | undefined; name: string; size?: number }): ReactElement {
  const key = brandOf(provider);
  return (
    <View style={[s.tile, { width: size, height: size, borderRadius: Math.round(size * 0.3) }]} testID={`logo-${key ?? "letter"}`}>
      {key ? <BrandMark provider={provider} size={Math.round(size * 0.62)} /> : <Text style={[s.tileLetter, { fontSize: Math.round(size * 0.48) }]}>{(name.trim()[0] ?? "?").toUpperCase()}</Text>}
    </View>
  );
}

/* ---------- effort bars, ring, light ---------- */

export function EffortBars({ effort, testID }: { effort: Effort | undefined; testID?: string }): ReactElement {
  const lit = effortBars(effort);
  return (
    <View style={s.bars} testID={testID} accessibilityLabel={`Effort ${lit} of 4`}>
      {/* ui-rows-lint: not a list (the four effort bars of one meter) */}
      {[0, 1, 2, 3].map((i) => <View key={i} style={[s.bar, i < lit && s.barOn]} />)}
    </View>
  );
}

/** The context ring: how full the model's context is. Drawn only past half (the caller decides). */
export function ContextRing({ pct, warn, size = 22 }: { pct: number; warn: boolean; size?: number }): ReactElement {
  const label = `Context ${Math.round(pct * 100)}% full`;
  if (!web) return <Text accessibilityLabel={label} style={[s.ringText, warn && s.ringWarn]}>{`${Math.round(pct * 100)}%`}</Text>;
  const r = 8, c = 2 * Math.PI * r;
  return (
    <View testID="composer-ring" accessibilityLabel={label} {...webOnly({ title: label })} style={{ width: size, height: size }}>
      {createElement("svg", { viewBox: "0 0 22 22", width: size, height: size, "aria-hidden": true },
        createElement("circle", { cx: 11, cy: 11, r, fill: "none", stroke: "var(--line-2)", strokeWidth: 2.5 }),
        createElement("circle", { cx: 11, cy: 11, r, fill: "none", stroke: warn ? "var(--warn)" : "var(--accent)", strokeWidth: 2.5, strokeDasharray: c, strokeDashoffset: c * (1 - pct), transform: "rotate(-90 11 11)", strokeLinecap: "round", "data-warn": warn ? "1" : "0" }))}
    </View>
  );
}

/** A thin light that runs along the top edge while an agent works. */
export function WorkingLight(): ReactElement {
  ensureComposerCss();
  return <View testID="composer-working-light" pointerEvents="none" style={[s.light, !web && s.lightNative]} {...webOnly({ dataSet: { cmpLight: "1" } })} />;
}

/* ---------- popovers ---------- */

const POP_SHADOW = { boxShadow: "var(--sh-pop)" } as unknown as ViewStyle;

/** The frame every composer popover sits in: raised, rounded, a soft long shadow, arriving with a short rise. */
export function Pop({ children, style, testID, label, onKeyDown, nodeRef }: { children: ReactNode; style?: ViewStyle | ViewStyle[]; testID: string; label: string; onKeyDown?: (e: { key: string; preventDefault(): void; stopPropagation?(): void }) => void; nodeRef?: (n: unknown) => void }): ReactElement {
  ensureComposerCss();
  return (
    <View
      testID={testID}
      accessibilityLabel={label}
      style={[s.pop, POP_SHADOW, style]}
      {...(nodeRef ? { ref: nodeRef as never } : {})}
      {...webOnly({ dataSet: { cmpPop: "1" }, role: "dialog", tabIndex: -1, ...(onKeyDown ? { onKeyDown } : {}), onMouseDown: (e: { target?: { tagName?: string }; preventDefault(): void }) => { if (e.target?.tagName !== "INPUT" && e.target?.tagName !== "TEXTAREA") e.preventDefault(); } })}
    >
      {children}
    </View>
  );
}

export function GroupHead({ label }: { label: string }): ReactElement {
  return <Text style={s.grp} accessibilityRole="header">{label}</Text>;
}

/** A small square tile with a line icon, for menu rows (Upload files, a command, a record). */
export function IconTile({ icon, tint, size = 26 }: { icon: string; tint?: string; size?: number }): ReactElement {
  // a hex tint gets a soft wash of itself (#rrggbb + alpha); anything else sits on the sunk ground
  const bg = tint && /^#[0-9a-f]{6}$/i.test(tint) ? `${tint}24` : "var(--sunk)";
  return (
    <View style={[s.iconTile, { width: size, height: size, backgroundColor: bg as string }]}>
      {web ? createElement("span", { style: { display: "inline-flex", color: tint ?? "var(--ink-2)" }, dangerouslySetInnerHTML: { __html: icon.replace("<svg", `<svg width="${Math.round(size * 0.58)}" height="${Math.round(size * 0.58)}"`) } }) : <Text style={s.tileLetter}>{"•"}</Text>}
    </View>
  );
}

/** A key hint at the end of a row (# @ / ⇧⇥). */
export function Kbd({ k }: { k: string }): ReactElement {
  return <Text style={s.kbd}>{k}</Text>;
}

/* ---------- line icons (24 grid, stroke) ---------- */

const svg = (d: string): string => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
export const I = {
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  up: svg('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  file: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>'),
  folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  record: svg('<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 10h18M9 10v10"/>'),
  chat: svg('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>'),
  bolt: svg('<path d="M13 3 4 14h7l-1 7 9-11h-7z"/>'),
  project: svg('<path d="M4 6h16M4 12h10M4 18h7"/>'),
  channel: svg('<path d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16"/>'),
  at: svg('<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>'),
  hash: svg('<path d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16"/>'),
  slash: svg('<path d="m15 4-6 16"/>'),
  cmd: svg('<path d="M4 17l6-6-6-6M12 19h8"/>'),
  skill: svg('<path d="M12 3l2.5 5 5.5.8-4 3.9.9 5.5L12 15.6 7.1 18.2 8 12.7 4 8.8 9.5 8z"/>'),
  template: svg('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  plan: svg('<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>'),
  check: svg('<path d="m5 12 5 5 9-10"/>'),
  chev: svg('<path d="m6 9 6 6 6-6"/>'),
  chevr: svg('<path d="m9 6 6 6-6 6"/>'),
  x: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  mail: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'),
  text: svg('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>'),
};
export const STOP = '<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/></svg>';

const s = StyleSheet.create({
  tile: { alignItems: "center", justifyContent: "center", backgroundColor: "var(--raised)" as string, borderWidth: 1, borderColor: "var(--line)" as string, overflow: "hidden", flexShrink: 0 },
  tileLetter: { color: "var(--ink-2)" as string, fontWeight: "700" },
  bars: { flexDirection: "row", gap: 2, marginLeft: 2, alignItems: "center" },
  bar: { width: 3, height: 9, borderRadius: 2, backgroundColor: "var(--line-2)" as string },
  barOn: { backgroundColor: "var(--accent)" as string },
  ringText: { fontSize: 11, color: "var(--ink-3)" as string, fontWeight: "600" },
  ringWarn: { color: "var(--warn)" as string },
  light: { position: "absolute", left: 18, right: 18, top: -1, height: 2, borderRadius: 2, zIndex: 2 },
  lightNative: { backgroundColor: "var(--accent)" as string, opacity: 0.6 },
  pop: { position: "absolute", zIndex: 60, backgroundColor: "var(--raised)" as string, borderWidth: 1, borderColor: "var(--line-2)" as string, borderRadius: 16 },
  grp: { fontSize: 11, fontWeight: "600", letterSpacing: 0.4, textTransform: "uppercase", color: "var(--ink-4)" as string, paddingTop: 10, paddingBottom: 4, paddingHorizontal: 10 },
  iconTile: { borderRadius: 8, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  kbd: { fontSize: 11, color: "var(--ink-4)" as string, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
});
