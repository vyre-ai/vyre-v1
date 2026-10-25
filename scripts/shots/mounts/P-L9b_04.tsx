// Mount for P-L9b_04: the conversation over the Northwind sample (Rivera intake with Intake leading and Docs listening). ?v= picks a variant: idle (default), streaming (Intake is writing
// an answer, held part-way), errors (Docs, with the inline error row), plan (a plan card and a question waiting, plan mode on), busy (two agents working and two helpers), nolead
// (nobody leads), closed, long (150 messages). Every control works against the sample replica: a send adds a message and the composer clears, Stop finishes the live steps, a mode
// change moves the lead. chat.post stays out while ?hold=1, so the picture shows a message that is sent but not yet confirmed.
//
// ?probe=open is the chat-open budget measured in the browser (ruling 43, budget chat_open: resume a chat, the last 50 messages ready in under 100 ms). It mounts the conversation
// over 150 messages six times in this page's own React tree, discards the first run (cold code paths), and takes the median of the five that follow. One run is: the replica already
// holds the thread (it is on the device), then React renders the conversation, the browser lays it out, and the last of the 50 messages is in the document with its box measured.
// The result is printed on the page, logged as a METRIC line, and kept on window.__probes.chat_open so a runner can read it; the worst run is printed beside the median.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { Text, View } from "react-native";
import { Conversation } from "../../../apps/app/src/places/chats/conversation/Conversation.tsx";
import { createSample } from "../../../apps/app/src/places/chats/conversation/sample.ts";
import type { Variant } from "../../../apps/app/src/places/chats/conversation/sample.ts";
import { OPEN_RUNS, summarizeOpen } from "../../../apps/app/src/places/chats/conversation/model.ts";
import type { OpenResult } from "../../../apps/app/src/places/chats/conversation/model.ts";

export const title = "Chats conversation";

const VARIANTS: readonly Variant[] = ["idle", "streaming", "busy", "errors", "plan", "long", "nolead", "closed"];
const isVariant = (v: string | null): v is Variant => VARIANTS.includes(v as Variant);

/** The few DOM members the probe uses; this tree has no DOM lib, so they are named here. */
interface Node_ {
  style: { cssText: string };
  appendChild(c: Node_): void;
  removeChild(c: Node_): void;
  querySelectorAll(sel: string): { length: number };
  querySelector(sel: string): { getBoundingClientRect(): unknown } | null;
}
type Doc = { createElement(t: string): Node_; getElementById(id: string): Node_ | null };

/** One open: mount a fresh conversation, return the milliseconds until the 50 messages are laid out, and how many were found. */
function openOnce(host: Node_): { ms: number; messages: number; last: boolean } {
  const doc = (globalThis as unknown as { document: Doc }).document;
  const box = doc.createElement("div");
  box.style.cssText = "position:absolute;inset:0;display:flex;flex-direction:column;";
  host.appendChild(box);
  const sample = createSample("long");
  const root = createRoot(box as unknown as Parameters<typeof createRoot>[0]);
  const t0 = performance.now();
  flushSync(() => root.render(<Conversation data={sample.data} />));
  const rows = box.querySelectorAll('[data-testid^="msg-"]');
  const last = box.querySelector('[data-testid="msg-f149"]');
  last?.getBoundingClientRect(); // forces layout of everything above it
  const ms = performance.now() - t0;
  const out = { ms, messages: rows.length, last: last !== null };
  root.unmount();
  host.removeChild(box);
  return out;
}

function OpenProbe(): ReactNode {
  const [res, setRes] = useState<OpenResult | null>(null);
  useEffect(() => {
    const doc = (globalThis as unknown as { document: Doc }).document;
    const host = doc.getElementById("open-probe-host");
    if (!host) return;
    // Wait two frames so fonts and the skin are applied before the first open, as they are in a resumed app.
    const g = globalThis as unknown as { requestAnimationFrame(cb: () => void): number; __probes?: Record<string, unknown> };
    g.requestAnimationFrame(() => g.requestAnimationFrame(() => {
      openOnce(host); // warm-up, discarded
      const runs: number[] = [];
      let messages = 0;
      let lastOk = true;
      for (let i = 0; i < OPEN_RUNS; i++) {
        const r = openOnce(host);
        runs.push(r.ms);
        messages = r.messages;
        lastOk = lastOk && r.last;
      }
      const out = summarizeOpen(runs, lastOk ? messages : -1);
      g.__probes = { ...(g.__probes ?? {}), chat_open: out };
      console.log(`METRIC ${JSON.stringify({ name: "chat_open", metric: "chat.last_50_ready_browser", median_ms: +out.median.toFixed(1), worst_ms: +out.worst.toFixed(1), runs_ms: out.runs.map((x) => +x.toFixed(1)), warmup_discarded: 1, budget_ms: out.budget, messages: out.messages, ok: out.ok })}`);
      setRes(out);
    }));
  }, []);
  const line = res === null ? "Measuring…" : `Chat open, last ${res.messages} messages: median ${res.median.toFixed(1)} ms, worst ${res.worst.toFixed(1)} ms of ${res.runs.length} (warm-up discarded), budget ${res.budget} ms: ${res.ok ? "ok" : "OVER BUDGET"}`;
  return (
    <View style={{ flex: 1, backgroundColor: "var(--win)" as string }}>
      <Text testID={res === null ? "open-probe-running" : "open-probe-done"} accessibilityLiveRegion="polite" style={{ padding: 12, fontSize: 13, color: (res !== null && !res.ok ? "var(--danger)" : "var(--ink)") as string }}>{line}</Text>
      <View nativeID="open-probe-host" style={{ flex: 1, position: "relative" }} />
    </View>
  );
}

export default function Mount(): ReactNode {
  // The query is read after mount: the static export renders the first frame without it, and the client must render that same frame or React leaves the exported markup behind.
  const [search, setSearch] = useState<string | null>(null);
  useEffect(() => setSearch((globalThis as { location?: { search?: string } }).location?.search ?? ""), []);
  const params = useMemo(() => new URLSearchParams(search ?? ""), [search]);
  const v = params.get("v");
  const hold = params.get("hold") === "1";
  const probe = params.get("probe") === "open";
  const sample = useMemo(() => {
    const s = createSample(isVariant(v) ? v : "idle");
    if (hold) s.holdPosts();
    return s;
  }, [v, hold]);
  if (search === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  if (probe) return <OpenProbe />;
  return (
    <View style={{ flex: 1, backgroundColor: "var(--win)" as string }}>
      <Conversation data={sample.data} />
    </View>
  );
}
