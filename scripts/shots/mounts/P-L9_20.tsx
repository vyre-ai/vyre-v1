// Mount for P-L9_20: a conversation with a message that is still being written. Two views of the same streaming parts:
//   /m/P-L9_20          the column of the Chats place: a question, then an answer arriving as markdown (a heading, a list, a code block, the caret), stopped part-way so the picture is the same every run.
//   /m/P-L9_20?probe=1  the same column with 150 messages of history (images in reserved boxes) in a scroll area the shots probe scrolls as a hard fling, while a live pane below receives a
//                       100 deltas/s stream on a loop. The probe's frame intervals are measured over that fling with the stream running, and its layout shift covers the whole page.
import { memo, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { AVATAR_SIZE, AvatarSlot, BLOCK_GAP, Feed, HEADER_GAP, MarkdownBlocks, ReservedImage, StreamText, createStreamStore, parseChunk } from "../../../ui/src/stream/index.ts";
import type { Block, StreamStore } from "../../../ui/src/stream/index.ts";

export const title = "Streaming chat";

const SCRIPT = [
  "# Intake form plan",
  "",
  "I read the three forms in the Northwind folder and **merged them into one**. The new form asks for the name, a phone number and the matter type, and it sends a confirmation to the client within a minute.",
  "",
  "Here is what changes for the front desk:",
  "",
  "1. New leads land in *Inbox* with the matter type already filled in",
  "2. The confirmation text comes from the `intake-confirm` template",
  "3. Anything that needs a lawyer is routed to Maya Chen",
  "",
  "```ts",
  "const form = await forms.create({ name: \"Intake\", fields });",
  "await forms.publish(form.id);",
  "```",
  "",
  "- No change to the paper forms",
  "- The old links keep working for 30 days",
  "",
  "Tell me if you want the phone number to be required.",
  "",
].join("\n");

/** The text the held view shows: enough for a heading, a paragraph and the start of the list. */
const HOLD_AT = 470;
const CHUNK = 4;
const TICK_MS = 10; // 100 deltas a second

const NAMES = ["Maya Chen", "Omar Haddad", "Intake", "Docs"];
const PNG = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

function search(): URLSearchParams {
  return new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "");
}

// ---- the parts of a conversation, as the chat place lays them out

const Header = memo(function Header({ who, time }: { who: string; time: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, height: AVATAR_SIZE + HEADER_GAP, paddingBottom: HEADER_GAP }}>
      <AvatarSlot label={who} color="var(--accent-wash)" />
      <Text style={{ color: "var(--ink)", fontSize: 13, fontWeight: "600" }}>{who}</Text>
      <Text style={{ color: "var(--ink-3)", fontSize: 11.5 }}>{time}</Text>
    </View>
  );
});

const Bubble = memo(function Bubble({ text }: { text: string }) {
  return (
    <View style={{ alignItems: "flex-end", paddingVertical: 2, marginTop: 4 }}>
      <View style={{ maxWidth: "85%", backgroundColor: "var(--me)", borderRadius: 18, paddingHorizontal: 15, paddingVertical: 9 }}>
        <Text style={{ color: "var(--ink)", fontSize: 15, lineHeight: 23 }}>{text}</Text>
      </View>
    </View>
  );
});

const Answer = memo(function Answer({ who, time, blocks, image }: { who: string; time: string; blocks: readonly Block[]; image?: boolean }) {
  return (
    <View style={{ paddingVertical: 2, marginTop: 18 }}>
      <Header who={who} time={time} />
      <MarkdownBlocks blocks={blocks} />
      {image ? <View style={{ marginBottom: BLOCK_GAP }}><ReservedImage uri={PNG} width={600} height={300} label="Floor plan" /></View> : null}
    </View>
  );
});

function Live({ store, who }: { store: StreamStore; who: string }): ReactNode {
  return (
    <View style={{ paddingVertical: 2, marginTop: 18 }}>
      <Header who={who} time="now" />
      <StreamText store={store} />
    </View>
  );
}

function Column({ children }: { children: ReactNode }): ReactNode {
  return <View style={{ width: "100%", maxWidth: 720, alignSelf: "center", paddingHorizontal: 28, paddingTop: 24, paddingBottom: 28 }}>{children}</View>;
}

// ---- the stream driver: deltas of a few characters every 10 ms, held or looped

function useScript(store: StreamStore, mode: "hold" | "loop"): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    let pos = 0;
    const cycle = `${SCRIPT}\n`;
    const iv = setInterval(() => {
      if (mode === "hold") {
        if (pos >= SCRIPT.length) { store.end(); clearInterval(iv); return; }
        if (pos >= HOLD_AT) { setHeld(true); clearInterval(iv); return; }
        store.push(SCRIPT.slice(pos, pos + CHUNK));
        pos += CHUNK;
        return;
      }
      // loop: one long answer that never ends (the text repeats), so the pane only ever grows, as a long answer does
      let d = "";
      for (let k = 0; k < CHUNK; k++) d += cycle.charAt((pos + k) % cycle.length);
      store.push(d);
      pos += CHUNK;
    }, TICK_MS);
    return () => clearInterval(iv);
  }, [store, mode]);
  return held;
}

// ---- the held conversation

function Chat(): ReactNode {
  const store = useMemo(() => createStreamStore(), []);
  const held = useScript(store, "hold");
  return (
    <View style={{ flex: 1, backgroundColor: "var(--win)" }}>
      <Feed store={store} contentStyle={{ paddingBottom: 8 }}>
        <Column>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 10, marginBottom: 16 }}>
            <View style={{ flex: 1, height: 1, backgroundColor: "var(--line)" }} />
            <Text style={{ color: "var(--ink-3)", fontSize: 11.5, fontWeight: "500" }}>Today</Text>
            <View style={{ flex: 1, height: 1, backgroundColor: "var(--line)" }} />
          </View>
          <Bubble text="Can you merge the three intake forms into one?" />
          <Live store={store} who="Intake" />
          {held ? <View testID="stream-held" style={{ height: 1 }} /> : null}
        </Column>
      </Feed>
    </View>
  );
}

// ---- the probe: long history, live pane

const SAMPLE: readonly Block[] = parseChunk(SCRIPT, 0);

interface Item { id: string; user: boolean; who: string; time: string; text: string; blocks: readonly Block[]; image: boolean }
const HISTORY: readonly Item[] = Array.from({ length: 150 }, (_, i) => {
  const user = i % 2 === 0;
  const from = i % (SAMPLE.length - 2);
  return {
    id: `h${i}`, user, who: user ? "You" : NAMES[(i >> 1) % NAMES.length] ?? "Intake", time: `${9 + (i >> 4)}:${String((i * 7) % 60).padStart(2, "0")}`,
    text: ["Can you check the Rivera file?", "What is left on the closing checklist?", "Draft the engagement letter for Elena."][i % 3] ?? "",
    blocks: SAMPLE.slice(from, from + 2 + (i % 3)).map((b, k) => ({ ...b, key: `h${i}-${k}` })) as Block[],
    image: !user && i % 6 === 1,
  };
});

function Probe(): ReactNode {
  const store = useMemo(() => createStreamStore(), []);
  useScript(store, "loop");
  return (
    <View style={{ flex: 1, backgroundColor: "var(--win)" }}>
      <Feed testID="history-list" follow={false}>
        <Column>
          {HISTORY.map((m) => (m.user ? <Bubble key={m.id} text={m.text} /> : <Answer key={m.id} who={m.who} time={m.time} blocks={m.blocks} image={m.image} />))}
        </Column>
      </Feed>
      <View style={{ height: 280, borderTopWidth: 1, borderTopColor: "var(--line)" }}>
        <Feed store={store} testID="stream-list">
          <Column>
            <Live store={store} who="Intake" />
          </Column>
        </Feed>
      </View>
    </View>
  );
}

export default function Mount(): ReactNode {
  return search().get("probe") === "1" ? <Probe /> : <Chat />;
}
