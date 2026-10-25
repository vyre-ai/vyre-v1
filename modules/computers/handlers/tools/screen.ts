// The Screen tools of an agent computer (spec 2.7: the full desktop on demand): a picture of the whole desktop, click, move, drag, type, key, scroll, wait. Coordinates are checked here so a
// wild value never reaches agentd; text typed may be a #Handle.field that agentd substitutes on the computer, and it is never written into the timeline.
import { raise } from "../../projections.ts";
import type { CompCtx } from "../../projections.ts";
import { call, defined, keepShot, prepare, run, shape } from "./common.ts";
import type { ToolSpec } from "./common.ts";

interface Base { computerId?: string | undefined }
const MAX_COORD = 16_384;
const inside = (ctx: CompCtx, ...v: Array<number | undefined>): void => {
  for (const n of v) if (!Number.isInteger(n) || (n as number) < 0 || (n as number) > MAX_COORD) raise(ctx, "validation.bad_input", `A position on the screen is a whole number from 0 to ${MAX_COORD}.`);
};

export async function screenshot(ctx: CompCtx, input: Base) {
  const spec: ToolSpec = { name: "screen_screenshot", caption: null };
  const r = await prepare(ctx, input.computerId, spec);
  if (!r) raise(ctx, "validation.bad_input", "The computer is asleep.");
  return keepShot(ctx, r.computer, "screen_screenshot", await call(ctx, r, spec, {}));
}

export async function click(ctx: CompCtx, input: Base & { x: number; y: number; button?: string; double?: boolean }) {
  inside(ctx, input.x, input.y);
  const out = await run(ctx, input, { name: "screen_click", caption: () => `${input.double === true ? "Double-clicked" : "Clicked"} the screen at ${input.x}, ${input.y}` }, defined({ x: input.x, y: input.y, button: input.button, double: input.double }));
  return shape(ctx, "screen_click", out, { ok: "b" });
}

export async function move(ctx: CompCtx, input: Base & { x: number; y: number }) {
  inside(ctx, input.x, input.y);
  const out = await run(ctx, input, { name: "screen_move", caption: null }, { x: input.x, y: input.y });
  return shape(ctx, "screen_move", out, { ok: "b" });
}

export async function drag(ctx: CompCtx, input: Base & { fromX: number; fromY: number; toX: number; toY: number }) {
  inside(ctx, input.fromX, input.fromY, input.toX, input.toY);
  const out = await run(ctx, input, { name: "screen_drag", caption: () => `Dragged from ${input.fromX}, ${input.fromY} to ${input.toX}, ${input.toY}` }, { fromX: input.fromX, fromY: input.fromY, toX: input.toX, toY: input.toY });
  return shape(ctx, "screen_drag", out, { ok: "b" });
}

export async function type(ctx: CompCtx, input: Base & { text: string }) {
  if (typeof input.text !== "string" || input.text === "") raise(ctx, "validation.bad_input", "Give the text to type.");
  if (input.text.length > 20_000) raise(ctx, "validation.bad_input", "That is too much to type in one call.");
  const out = await run(ctx, input, { name: "screen_type", caption: () => "Typed on the desktop" }, { text: input.text });
  return shape(ctx, "screen_type", out, { ok: "b" });
}

/** ctrl+l, Return, alt+Tab, super+d, F5 ... letters, digits and the usual key names joined by +. */
const COMBO = /^[A-Za-z0-9_]{1,20}(\+[A-Za-z0-9_]{1,20}){0,5}$/;

export async function key(ctx: CompCtx, input: Base & { combo: string }) {
  if (typeof input.combo !== "string" || !COMBO.test(input.combo)) raise(ctx, "validation.bad_input", "Name a key or a combination such as ctrl+l.");
  const out = await run(ctx, input, { name: "screen_key", caption: () => `Pressed ${input.combo}` }, { combo: input.combo });
  return shape(ctx, "screen_key", out, { ok: "b" });
}

export async function scroll(ctx: CompCtx, input: Base & { x: number; y: number; dx?: number; dy: number }) {
  inside(ctx, input.x, input.y);
  for (const d of [input.dx ?? 0, input.dy]) if (!Number.isInteger(d) || Math.abs(d) > 100_000) raise(ctx, "validation.bad_input", "Scroll by a whole number of pixels.");
  const out = await run(ctx, input, { name: "screen_scroll", caption: null }, defined({ x: input.x, y: input.y, dx: input.dx, dy: input.dy }));
  return shape(ctx, "screen_scroll", out, { ok: "b" });
}

export async function wait(ctx: CompCtx, input: Base & { ms: number }) {
  if (!Number.isInteger(input.ms) || input.ms < 50 || input.ms > 60_000) raise(ctx, "validation.bad_input", "Wait from 50 to 60000 milliseconds.");
  const out = await run(ctx, input, { name: "screen_wait", caption: null, timeoutMs: input.ms + 5_000 }, { ms: input.ms });
  return shape(ctx, "screen_wait", out, { ok: "b" });
}
