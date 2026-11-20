// What xterm.js is given: a tmux capture reduced to colour and style sequences, placed on a cleared grid. No browser here, so it is tested without one.
export interface XShot {
  text: string;
  cols: number;
  rows: number;
  cursor: { x: number; y: number } | null;
}

/**
 * One line of tmux's capture as xterm may take it: the colour and style sequences (SGR) stay, every other escape and control character goes. A captured line must never move the cursor, switch
 * screens or change a mode: the screen is placed by this file alone.
 */
export function sgrOnly(line: string): string {
  const re =
    /\x1b\[([0-9;:]*)m|\x1b\[[0-9;:?<=>! ]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[^[\]]?|[\x00-\x08\x0b-\x1a\x1c-\x1f\x7f-\x9f]/g;
  return line.replace(re, (m, sgr: string | undefined) => (sgr !== undefined ? `\x1b[${sgr.replace(/:/g, ";")}m` : ""));
}

/** The bytes that draw a capture on a cleared grid: every line in order, then the cursor placed where tmux says. */
export function frameOf(shot: XShot): string {
  const lines = shot.text.split("\n");
  const top = Math.max(0, lines.length - shot.rows);
  const body = lines.map((l) => `${sgrOnly(l)}\x1b[0m`).join("\r\n");
  const at = shot.cursor === null ? "\x1b[?25l" : `\x1b[${top + shot.cursor.y + 1};${shot.cursor.x + 1}H\x1b[?25h`;
  return `\x1b[0m\x1b[H\x1b[2J${body}${at}`;
}

/** How many rows fit in `room` pixels of height at `rowHeight` pixels a row. Zero when the row height is not known (no row has been drawn, or the renderer draws no DOM rows): the screen then keeps the capture's own line count. */
export function rowsThatFit(room: number, rowHeight: number): number {
  if (!Number.isFinite(room) || !Number.isFinite(rowHeight) || rowHeight <= 0 || room <= 0) return 0;
  return Math.floor(room / rowHeight);
}

/** The rows the terminal is drawn on: every line of the capture, and at least as many as fit the pane. */
export function rowsToDraw(captureLines: number, fit: number): number {
  return Math.max(1, captureLines, fit);
}

/** The slice of an xterm Terminal the wheel decision reads. */
export interface WheelView {
  modes: { mouseTrackingMode: string };
  buffer: { active: { type: string } };
}

/**
 * Whether the screen's own box takes the wheel (and the trackpad) instead of xterm: when no mouse mode is on and the normal buffer shows (not the alternate screen of vim, less or htop). A program that asks for the
 * mouse, or draws on the alternate screen, gets the wheel through xterm as it should. Today this screen is display-only (see XTermView) and a captured frame never switches either on, so the box always takes it;
 * the check is what keeps that true if xterm ever forwards input to the program.
 */
export function boxTakesWheel(t: WheelView): boolean {
  return t.modes.mouseTrackingMode === "none" && t.buffer.active.type === "normal";
}
