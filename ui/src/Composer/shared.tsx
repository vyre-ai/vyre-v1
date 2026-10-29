import type { ReactElement } from "react";
import { Platform, Text } from "react-native";
import { MenuIcon } from "../Menu/index.tsx";

/** Text pasted as plain text: line breaks kept, tabs and control characters dropped. */
export function plainText(raw: string): string {
  return raw.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\t/g, " ");
}

const svg = (d: string): string => `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
export const ICON_UP = svg('<path d="M8 13V3M3.5 7.5L8 3l4.5 4.5"/>');

/** An icon: inline svg on web, a plain character on native until the native icon set lands. */
export function Glyph({ icon, native, size = 16, color }: { icon: string; native: string; size?: number; color?: string }): ReactElement {
  if (Platform.OS === "web") return <MenuIcon icon={icon} size={size} {...(color === undefined ? {} : { color })} />;
  return <Text style={{ color: color ?? "var(--ink-3)", fontSize: size, lineHeight: size + 2 }}>{native}</Text>;
}
