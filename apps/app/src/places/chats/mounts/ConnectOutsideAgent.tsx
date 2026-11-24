// Connect an outside agent (spec 3.2 Flow 9, registry screen chats.connect-outside-agent): a sheet with one link. Paste it into Claude Code, Cursor or any MCP app and that app signs itself in: a browser tab opens, Vyre shows who is
// asking, and one press makes it an agent the person owns. There is no token to copy and no list of scopes: it can do what the person can, and no more. Claude Code's line is proven with the real CLI
// (test/outside-agents.cli.live.test.ts); what this sheet says about other apps stays honest about what has not been tried.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { CapMap } from "../../../../../../generated/types.ts";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { Icon, TextButton } from "../rightpane/parts.tsx";
import { LayerHead, Sheet } from "./Layers.tsx";
import { errorWords } from "./live.ts";
import { APPS, howTo } from "./connect-apps.ts";
import type { AppId } from "./connect-apps.ts";

export const CONNECT_SCREEN = "chats.connect-outside-agent";
type Link = CapMap["mcp.connected.link"]["out"];

export const CONNECT_SUB = "It signs in as you. You press Allow once.";
export const LOGIN_LINE = "claude mcp login vyre";
export const UNPROVEN = "Tested with Claude Code. Codex and Cursor take the same link and have not been tested yet.";

const writeClipboard = (text: string): boolean => {
  const clip = (globalThis as { navigator?: { clipboard?: { writeText(t: string): unknown } } }).navigator?.clipboard;
  if (!clip) return false;
  void clip.writeText(text);
  return true;
};

export interface ConnectProps {
  call(cap: string, input: unknown): Promise<unknown>;
  onClose: () => void;
  /** A line the app shows for a moment ("Copied the link"). */
  say?: (text: string) => void;
}

function Copyable({
  label,
  text,
  testID,
  onCopy,
}: {
  label: string;
  text: string;
  testID: string;
  onCopy: () => void;
}): ReactElement {
  return (
    <>
      <Text style={st.label}>{label}</Text>
      <View style={st.kv}>
        <Text selectable testID={testID} style={st.code}>
          {text}
        </Text>
        <TextButton label="Copy" onPress={onCopy} testID={`${testID}-copy`} />
      </View>
    </>
  );
}

export function ConnectOutsideAgent({ call, onClose, say }: ConnectProps): ReactElement {
  const [link, setLink] = useState<Link | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [line, setLine] = useState<string | null>(null);
  const [app, setApp] = useState<AppId | null>(null);
  useEffect(() => {
    let live = true;
    void call("mcp.connected.link", {}).then(
      (out) => {
        if (live) setLink(out as Link);
      },
      (e: unknown) => {
        if (live) setProblem(errorWords(e, "Could not read this Space's address."));
      },
    );
    return () => {
      live = false;
    };
  }, [call]);
  useEffect(() => {
    if (line === null) return undefined;
    const t = setTimeout(() => setLine(null), 2500);
    return () => clearTimeout(t);
  }, [line]);
  const copy = (what: string, text: string): void => {
    const words = writeClipboard(text) ? `Copied the ${what}` : `Could not copy the ${what}`;
    setLine(words);
    say?.(words);
  };
  return (
    <Sheet label="Connect an app" testID="connect-outside-agent" width={480} onClose={onClose}>
      <LayerHead
        title="Connect an app"
        sub={CONNECT_SUB}
        lead={
          <View style={st.tile}>
            <Icon name="terminal" size={16} color="var(--ink-2)" />
          </View>
        }
        onClose={onClose}
      />
      <View style={st.body}>
        {link && app === null ? (
          <View testID="connect-pick">
            {APPS.map((a) => (
              <Row
                key={a.id}
                id={`connect-app-${a.id}`}
                title={a.name}
                leading={<Icon name={a.icon} size={16} color="var(--ink-2)" />}
                onPress={() => setApp(a.id)}
              />
            ))}
            <Row id="connect-app-other" title="Another app" onPress={() => setApp("other")} />
          </View>
        ) : link && app !== null ? (
          <>
            {/* ui-rows-lint: not a list (numbered instructions, each a line of text with nothing to press) */}
            {howTo(app, link).steps.map((t, i) => (
              <Text key={t} testID={`connect-step-${i + 1}`} style={st.help}>
                {`${i + 1}. ${t}`}
              </Text>
            ))}
            {/* ui-rows-lint: not a list (each is a labelled address to copy, a field with its Copy button) */}
            {howTo(app, link).copy.map((c) => (
              <Copyable
                key={c.testID}
                label={c.label}
                text={c.text}
                testID={c.testID}
                onCopy={() => copy(c.label.toLowerCase(), c.text)}
              />
            ))}
            {howTo(app, link).open ? (
              <TextButton
                label={howTo(app, link).open!.label}
                testID="connect-open-app"
                onPress={() => {
                  const w = globalThis as { location?: { href: string } };
                  if (w.location) w.location.href = howTo(app, link).open!.href;
                }}
              />
            ) : null}
            <TextButton label="Back" onPress={() => setApp(null)} testID="connect-back" />
            <Text testID="connect-proven" style={st.help}>
              {UNPROVEN}
            </Text>
          </>
        ) : problem ? (
          <Text testID="connect-problem" accessibilityRole="alert" style={st.problem}>
            {problem}
          </Text>
        ) : (
          <View testID="connect-loading" accessibilityLabel="Loading" style={st.loading} />
        )}
      </View>
      <View style={st.foot}>
        <Text testID="connect-status" accessibilityLiveRegion="polite" style={st.status}>
          {line ?? ""}
        </Text>
        <View style={{ flex: 1 }} />
        <TextButton label="Done" onPress={onClose} testID="connect-done" />
      </View>
    </Sheet>
  );
}

const st = StyleSheet.create({
  tile: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "var(--sunk)" as string,
  },
  body: { paddingHorizontal: 14, gap: 6, minHeight: 120 },
  label: { fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" as string, marginTop: 6 },
  kv: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingLeft: 10,
    paddingRight: 4,
    minHeight: 34,
    borderRadius: 8,
    backgroundColor: "var(--sunk)" as string,
  },
  code: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    lineHeight: 17,
    color: "var(--ink)" as string,
    fontFamily: "var(--mono, ui-monospace, Menlo, monospace)" as string,
    paddingVertical: 7,
  },
  help: { fontSize: 12, lineHeight: 17, color: "var(--ink-3)" as string, marginTop: 6 },
  loading: { height: 100, borderRadius: 10, backgroundColor: "var(--sunk)" as string },
  problem: { fontSize: 12.5, color: "var(--danger)" as string },
  foot: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 12 },
  status: { fontSize: 12.5, color: "var(--ink-3)" as string },
});
