// The Space AI key line every "Connect your AI" place shows above its choices: whether this Space's key covers the person (its provider and models, read live), and with no key who can
// add one, by name and role. It never offers anything itself; the place's own sign-ins and keys sit under it, so there is always a way forward.
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { Row } from "../../../../ui/src/Row/index.tsx";
import { readSpaceAi, spaceAiWords } from "./own-ai.ts";
import type { SpaceAiWords, SpaceKeyState } from "./own-ai.ts";

type Call = (cap: string, input?: unknown) => Promise<unknown>;
export type SpaceAiRead = { key: SpaceKeyState | "error" | null; admin: string | null };

/** The Space AI key and who can add one, read once per person. `initial` skips the read (tests and screenshots); `off` reads nothing. */
export function useSpaceAi(call: Call, o: { me?: string; fallbackAdmin?: string; initial?: SpaceAiRead; off?: boolean } = {}): SpaceAiWords {
  const [read, setRead] = useState<SpaceAiRead>(o.initial ?? { key: null, admin: null });
  // the caller may hand a new function each render: the read follows the latest one but runs once per person, not once per render
  const latest = useRef(call);
  latest.current = call;
  const given = o.initial !== undefined;
  useEffect(() => {
    if (given || o.off) return undefined;
    let alive = true;
    void readSpaceAi((cap, input) => latest.current(cap, input), { ...(o.me ? { me: o.me } : {}), ...(o.fallbackAdmin ? { fallbackAdmin: o.fallbackAdmin } : {}) }).then((r) => { if (alive) setRead(r); });
    return () => { alive = false; };
  }, [o.me, o.fallbackAdmin, given, o.off]);
  return spaceAiWords(read.key, read.admin);
}

/** "This Space's AI key (OpenCode Go) works for you. Models: glm-5.3, kimi-k3" */
export function statusNote(w: SpaceAiWords): string {
  return [w.line, w.models ? `Models: ${w.models}` : ""].filter(Boolean).join(" ");
}

export function SpaceAiStatus({ call, me, fallbackAdmin, initial, testID = "space-ai-status" }: { call: Call; me?: string; fallbackAdmin?: string; initial?: SpaceAiRead; testID?: string }): ReactElement {
  const words = useSpaceAi(call, { ...(me ? { me } : {}), ...(fallbackAdmin ? { fallbackAdmin } : {}), ...(initial ? { initial } : {}) });
  const note = statusNote(words);
  return (
    <View testID={testID} style={s.box}>
      <Row id={testID} title={words.title} {...(note ? { note } : {})} tall={note.length > 60} />
    </View>
  );
}

const s = StyleSheet.create({
  box: { borderRadius: 12, borderWidth: 1, borderColor: "var(--line)" as string, padding: 4, backgroundColor: "var(--win)" as string },
});
