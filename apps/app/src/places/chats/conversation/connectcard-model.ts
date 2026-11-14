// The shape and the words of the connect card, read from what the server answers (vault.connect_card.*). Pure: nothing here calls the server.
import type { ConnectField } from "../../../../../../ui/src/ConnectCard/index.tsx";

export type CardState = "ask" | "have" | "admin" | "asked" | "connected" | "wrong" | "offline" | "later" | "gone";

export interface ConnectCardData {
  requestId: string;
  state: CardState;
  service: { key: string; title: string; site?: string };
  fields: ConnectField[];
  agentId?: string;
  mayFill: boolean;
  admin?: { id: string; askedAt?: number };
  have?: { itemId: string; name: string; keptIn: string };
  keptIn?: string;
  tested?: string;
  connectedBy?: string;
  connectionId?: string;
  usedBy: { kind: string; id: string }[];
}

export interface KeptInFolder {
  id: string;
  name: string;
  scope: "mine" | "shared";
  usable: boolean;
}

const asObj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** The card out of a vault.connect_card.* answer, or null when it does not look like one. */
export function cardOf(out: unknown): ConnectCardData | null {
  const c = asObj(asObj(out)?.["card"]);
  const svc = asObj(c?.["service"]);
  if (!c || !svc || typeof c["requestId"] !== "string" || typeof svc["title"] !== "string") return null;
  return c as unknown as ConnectCardData;
}

/** The three steps of a try, in the order the server does them. A saved key is not typed, so it is not Checked here: the connection's own probe does that, and the steps are two. */
export const STEPS = ["Checked", "Connected", "Saved"] as const;
export const stepsFor = (useSaved: boolean): readonly string[] => (useSaved ? STEPS.slice(1) : STEPS);

/** "Mine", or the folder the person chose; before a choice, where the card says it will be kept: Mine. */
export function keptWords(chosen: KeptInFolder | null, card: ConnectCardData): string {
  if (chosen) return chosen.scope === "mine" ? "Mine" : chosen.name;
  return card.keptIn ?? "Mine";
}
