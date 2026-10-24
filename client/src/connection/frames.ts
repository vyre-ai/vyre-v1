// The frames the manager reads (ARCH 5.9). They mirror sync/src/protocol.ts, which the client layer may not import; modules/sync/tests/live.contract.test.ts holds the two together.
// Only the frames the manager acts on are typed here. Everything else (turn, presence, typing, ydoc.*, computer.frame) is handed on untouched.
export type Mode = "live" | "update_required" | "resync" | "purge";
export type DeviceClass = "desktop" | "phone" | "web";

export interface FieldVal { v: unknown; hlc: string; actor: string; enc?: { key: string; nonce: string } }
export interface WireChange { seq: number; entity: string; id: string; op: "upsert" | "patch" | "delete"; fields: Record<string, FieldVal>; trace?: string }
export interface WireHide { entity: string; id: string; seq: number }
export interface HelloOk { serverVersion: string; epoch: number; serverHlc: string; mode: Mode; head: number; entityVersions: Record<string, number> }

export interface HelloInfo {
  deviceId: string;
  deviceClass: DeviceClass;
  appVersion: string;
  registryHash: string;
  epoch: number;
  replica: { entities: Record<string, number> };
}

/** One numbered item batch: apply it, then the manager acks `seq` and the cursor moves there. */
export interface EventBatch { seq: number; items: WireChange[]; hide: WireHide[] }

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

export function readHelloOk(f: unknown): HelloOk | null {
  if (!isObj(f) || f["t"] !== "hello_ok" || !isObj(f["ok"])) return null;
  const o = f["ok"];
  const mode = o["mode"];
  if (mode !== "live" && mode !== "update_required" && mode !== "resync" && mode !== "purge") return null;
  if (!isInt(o["epoch"]) || !isInt(o["head"]) || typeof o["serverHlc"] !== "string" || typeof o["serverVersion"] !== "string" || !isObj(o["entityVersions"])) return null;
  return o as unknown as HelloOk;
}

export function readEvent(f: unknown): EventBatch | null {
  if (!isObj(f) || f["t"] !== "ev" || !isInt(f["seq"]) || !Array.isArray(f["items"])) return null;
  const hide = f["hide"] === undefined ? [] : f["hide"];
  if (!Array.isArray(hide)) return null;
  return { seq: f["seq"], items: f["items"] as WireChange[], hide: hide as WireHide[] };
}
