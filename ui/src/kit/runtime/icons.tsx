// Stroke icons for the state views (24 grid, 1.6 stroke, current colour). Drawn as SVG on web; native hosts get a quiet ring
// until the shared icon set lands. Names match the frozen States props.
import { createElement } from "react";
import { Platform, View } from "react-native";
import { STATE_ICONS, type StateIcon } from "../../States/props.ts";

const PATHS: Readonly<Record<StateIcon, readonly string[]>> = {
  inbox: ["M3 13h5l1.5 3h5L16 13h5", "M5.5 5h13L21 13v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z"],
  search: ["M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15z", "M16 16l5 5"],
  files: ["M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z", "M14 3v5h5"],
  records: ["M4 5h16v14H4z", "M4 10h16", "M10 10v9"],
  chat: ["M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4A8 8 0 1 1 20 12z"],
  offline: ["M2 9a15 15 0 0 1 4-2.6M22 9a15 15 0 0 0-8.5-4.5M5.5 12.5a10 10 0 0 1 3-1.8M18.5 12.5a10 10 0 0 0-3.6-2.3M9 16a5 5 0 0 1 6 0", "M12 20h.01", "M3 3l18 18"],
  error: ["M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18z", "M12 8v5", "M12 16.5h.01"],
  done: ["M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18z", "M8 12.5l2.7 2.7L16 9.8"],
};

export function isStateIcon(name: string): name is StateIcon {
  return (STATE_ICONS as readonly string[]).includes(name);
}

export function Icon({ name, size = 28, color = "var(--ink-3)" }: { name: StateIcon; size?: number; color?: string }) {
  if (Platform.OS !== "web") {
    return <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 1.6, borderColor: color }} />;
  }
  return createElement(
    "svg",
    {
      width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: color, strokeWidth: 1.6,
      strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, "data-icon": name, style: { flex: "none", display: "block" },
    },
    ...PATHS[name].map((d) => createElement("path", { key: d, d })),
  );
}
