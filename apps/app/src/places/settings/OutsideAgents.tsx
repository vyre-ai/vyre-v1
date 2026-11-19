// Settings > Connected apps: the apps you let in from outside Vyre, under your own things because each one is yours alone. A row says what the app did last, in plain words, and when; the green dot is an app working
// now. Pressing a row opens what it did lately, its Setup switch ("Act for me, including setup", owner ruling 3 Nov) and Remove, which ends its sign-in at once. Connecting one is the same sheet as a channel's.
import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import type { CapMap } from "../../../../../generated/types.ts";
import { agoLabel } from "../chats/rightpane/model.ts";
import { ConnectOutsideAgent } from "../chats/mounts/ConnectOutsideAgent.tsx";
import { Glyph, Section, SettingsRow, SmallButton, Switch, Value } from "./ui.tsx";
import { useSettingsData } from "./data.tsx";
import { useSaved } from "./saved.tsx";
import { CONNECTED_NOTE, activeNow, appGlyph, appSub, appWhen } from "./outside-model.ts";
import type { Connected } from "./outside-model.ts";

type Did = CapMap["mcp.activity.list"]["out"]["rows"][number];

/** What one open app did lately: the newest few lines, in plain words, each with its time. */
function Lately({ agentId }: { agentId: string }): ReactElement | null {
  const data = useSettingsData();
  const [rows, setRows] = useState<readonly Did[] | null>(null);
  useEffect(() => {
    let live = true;
    void data.call("mcp.activity.list", { agentId, limit: 5 }).then(
      (o) => live && setRows((o as CapMap["mcp.activity.list"]["out"]).rows),
      () => live && setRows([]),
    );
    return () => {
      live = false;
    };
  }, [data, agentId]);
  const clock = data.clock();
  if (rows === null || rows.length === 0) return null;
  return (
    <View testID={`outside-lately-${agentId}`}>
      {rows.map((r, i) => (
        <SettingsRow
          key={r.id}
          id={`outside.${agentId}.${r.id}`}
          label={r.did}
          indent
          first={i === 0}
          control={<Value text={agoLabel(r.at, { now: clock.now, offsetMin: clock.offsetMin })} />}
        />
      ))}
    </View>
  );
}

export function OutsideAgents(): ReactElement {
  const data = useSettingsData();
  const saved = useSaved();
  const [rows, setRows] = useState<readonly Connected[] | null>(null);
  const [sheet, setSheet] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const read = useCallback(() => {
    void data.call("mcp.connected.list", {}).then(
      (o) => setRows((o as CapMap["mcp.connected.list"]["out"]).agents),
      () => setRows([]),
    );
  }, [data]);
  useEffect(read, [read]);
  const clock = data.clock();
  const failed = (e: unknown, fallback: string): void =>
    saved.failed((e as { error?: { message?: string } } | null)?.error?.message ?? fallback);
  const setSetup = (agentId: string, on: boolean): void => {
    void data
      .call("mcp.setup.set", { agentId, setup: on })
      .then(() => {
        saved.saved(on ? "It can now set things up as you." : "It asks you first again.");
        read();
      })
      .catch((e: unknown) => failed(e, "That did not change."));
  };
  const remove = (agentId: string): void => {
    void data
      .call("mcp.connected.remove", { agentId })
      .then(() => {
        saved.saved("Removed. Its sign-in has ended.");
        setOpen((now) => (now === agentId ? null : now));
        read();
      })
      .catch((e: unknown) => failed(e, "That did not remove it."));
  };
  const list: ReactElement[] = [];
  (rows ?? []).forEach((a, i) => {
    const on = activeNow(a, clock.now);
    const shown = open === a.agentId;
    list.push(
      <SettingsRow
        key={a.agentId}
        id={`outside.${a.agentId}`}
        label={a.clientName}
        first={i === 0}
        sub={appSub(a, clock)}
        lead={<Glyph name={appGlyph(a.clientName)} size={15} color={on ? "var(--accent)" : "var(--ink-3)"} />}
        onPress={() => setOpen(shown ? null : a.agentId)}
        control={
          <>
            {on ? <Text accessibilityLabel="Working now" testID={`outside-live-${a.agentId}`} style={{ color: "var(--accent)" }}>{"\u25CF"}</Text> : null}
            <Value text={appWhen(a, clock)} />
            <Glyph name={shown ? "chevD" : "chevR"} size={13} />
          </>
        }
      />,
    );
    if (shown) {
      list.push(
        <Lately key={`${a.agentId}-lately`} agentId={a.agentId} />,
        <SettingsRow
          key={`${a.agentId}-setup`}
          id={`outside.${a.agentId}.setup`}
          label="Act for me, including setup"
          sub={a.redirectHost ? `Connected from ${a.redirectHost}` : undefined}
          indent
          control={
            <Switch
              on={a.setup === true}
              label={`${a.clientName} acts for you, including setup`}
              testID={`outside-setup-${a.agentId}`}
              onChange={(v) => setSetup(a.agentId, v)}
            />
          }
        />,
        <SettingsRow
          key={`${a.agentId}-rm`}
          id={`outside.${a.agentId}.remove`}
          label="Remove this app"
          sub="Its sign-in ends at once."
          indent
          danger
          control={<SmallButton label="Remove" danger testID={`outside-remove-${a.agentId}`} onPress={() => remove(a.agentId)} />}
        />,
        ...(data.nav.openAgent
          ? [
              <SettingsRow
                key={`${a.agentId}-page`}
                id={`outside.${a.agentId}.page`}
                label="Everything it did"
                indent
                onPress={() => data.nav.openAgent?.(a.agentId)}
                control={<Glyph name="chevR" size={13} />}
              />,
            ]
          : []),
      );
    }
  });
  return (
    <Section title="Connected apps" note={CONNECTED_NOTE} testID="outside-agents">
      {list}
      <SettingsRow
        id="connect-outside"
        label="Connect an app"
        sub="Claude, ChatGPT, Cursor, Claude Code or any MCP app"
        first={list.length === 0}
        lead={<Glyph name="plus" size={15} />}
        onPress={() => setSheet(true)}
        control={<Glyph name="chevR" size={13} />}
      />
      {sheet ? (
        <ConnectOutsideAgent
          call={data.call}
          onClose={() => {
            setSheet(false);
            read();
          }}
          say={(t) => saved.saved(t)}
        />
      ) : null}
    </Section>
  );
}
