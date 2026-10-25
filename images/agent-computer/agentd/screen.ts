// The Screen tools of an agent computer (modules/computers/handlers/tools/screen.ts): the whole desktop, not just the browser. A picture, click, move, drag, type, key, scroll, wait.
import { badInput, sleep } from "./errors.ts";
import { screenshotPng } from "./x11.ts";
import type { Injector, Screen } from "./x11.ts";

const BUTTONS: Record<string, number> = { left: 1, middle: 2, right: 3 };
const MODIFIERS: Record<string, string> = { ctrl: "Control_L", control: "Control_L", alt: "Alt_L", shift: "Shift_L", super: "Super_L", meta: "Super_L", cmd: "Super_L" };
const NAMES: Record<string, string> = {
  enter: "Return", return: "Return", esc: "Escape", escape: "Escape", tab: "Tab", del: "Delete", delete: "Delete", backspace: "BackSpace", space: "space", left: "Left", right: "Right", up: "Up", down: "Down",
  pageup: "Prior", pagedown: "Next", home: "Home", end: "End", insert: "Insert",
};

/** "ctrl+l" -> the keys to press, modifiers first. */
export function comboKeys(combo: string): { modifiers: string[]; key: string } {
  const parts = combo.split("+").map((p) => p.trim()).filter(Boolean);
  const last = parts.pop();
  if (!last) throw badInput("Name a key or a combination such as ctrl+l.");
  const modifiers = parts.map((p) => MODIFIERS[p.toLowerCase()] ?? "");
  if (modifiers.includes("")) throw badInput(`I only know ctrl, alt, shift and super as modifiers: ${combo}`);
  const lower = last.toLowerCase();
  const key = NAMES[lower] ?? (/^f([1-9]|1[0-2])$/.test(lower) ? lower.toUpperCase() : last.length === 1 ? last : "");
  if (key === "") throw badInput(`I do not know the key ${last}.`);
  return { modifiers, key };
}

export interface ScreenTools { run(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> }

export function screenTools(screen: Screen, input: Injector, onInput: (e: Record<string, unknown>) => void): ScreenTools {
  const int = (v: unknown, name: string, max: number): number => {
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > max) throw badInput(`${name} is a whole number from 0 to ${max}.`);
    return v;
  };
  const at = (x: unknown, y: unknown): { x: number; y: number } => ({ x: int(x, "x", screen.width - 1), y: int(y, "y", screen.height - 1) });
  const click = async (n: number, count: number): Promise<void> => {
    for (let i = 0; i < count; i++) { await input.call({ op: "button", n, down: true }); await input.call({ op: "button", n, down: false }); }
  };

  return {
    async run(name, args) {
      switch (name) {
        case "screen_screenshot": {
          const png = await screenshotPng(screen);
          return { png: png.toString("base64"), width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
        }
        case "screen_click": {
          const p = at(args["x"], args["y"]);
          await input.call({ op: "move", ...p });
          await click(BUTTONS[String(args["button"] ?? "left")] ?? 1, args["double"] === true ? 2 : 1);
          onInput({ type: "click", ...p });
          return { ok: true };
        }
        case "screen_move": {
          const p = at(args["x"], args["y"]);
          await input.call({ op: "move", ...p });
          return { ok: true };
        }
        case "screen_drag": {
          const from = at(args["fromX"], args["fromY"]);
          const to = at(args["toX"], args["toY"]);
          await input.call({ op: "move", ...from });
          await input.call({ op: "button", n: 1, down: true });
          for (let i = 1; i <= 8; i++) await input.call({ op: "move", x: Math.round(from.x + ((to.x - from.x) * i) / 8), y: Math.round(from.y + ((to.y - from.y) * i) / 8) });
          await input.call({ op: "button", n: 1, down: false });
          onInput({ type: "drag", from, to });
          return { ok: true };
        }
        case "screen_type": {
          const text = args["text"];
          if (typeof text !== "string" || text === "") throw badInput("Give the text to type.");
          await input.call({ op: "type", text });
          onInput({ type: "type", chars: text.length });
          return { ok: true };
        }
        case "screen_key": {
          const { modifiers, key } = comboKeys(String(args["combo"] ?? ""));
          for (const m of modifiers) await input.call({ op: "key", name: m, down: true });
          await input.call({ op: "key", name: key, down: true });
          await input.call({ op: "key", name: key, down: false });
          for (const m of [...modifiers].reverse()) await input.call({ op: "key", name: m, down: false });
          onInput({ type: "key", combo: String(args["combo"]) });
          return { ok: true };
        }
        case "screen_scroll": {
          const p = at(args["x"], args["y"]);
          await input.call({ op: "move", ...p });
          await input.call({ op: "scroll", dx: Number(args["dx"] ?? 0), dy: Number(args["dy"] ?? 0) });
          return { ok: true };
        }
        case "screen_wait": {
          await sleep(int(args["ms"], "ms", 60_000));
          return { ok: true };
        }
        default:
          throw badInput(`${name} is not a screen tool.`);
      }
    },
  };
}
