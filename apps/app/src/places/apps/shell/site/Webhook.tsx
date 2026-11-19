// The GitHub webhook of a site that comes from a repo: on or off, the address and the secret to give GitHub (the secret is shown once, when it is made), and which branches get a preview on a push.
// The production branch deploys on a push when the site deploys on push; nothing else builds. The secret is never read back: losing it means making a new one.
import { useState } from "react";
import type { ReactElement } from "react";
import { Text, TextInput, View } from "react-native";
import type { CapMap } from "../../../../../../../generated/types.ts";
import { Row } from "../../../../../../../ui/src/Row/index.tsx";
import { useAppsData } from "../data.tsx";
import { Button, Card, s as ui, useRead } from "../editor-ui.tsx";
import { errorMessage } from "../mutations.ts";
import { ago } from "../model.ts";
import { parseFollow } from "./model.ts";
import type { Site } from "./model.ts";

type Hook = CapMap["sites.webhook_get"]["out"];

export function Webhook({ site, online, busy }: { site: Site; online: boolean; busy: boolean }): ReactElement | null {
  const d = useAppsData();
  const info = useRead<Hook>("sites.webhook_get", { siteId: site.siteId }, "sites");
  const [secret, setSecret] = useState<string | null>(null);
  const [follow, setFollow] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [say, setSay] = useState<string | null>(null);
  if (!site.source?.repo) return null;
  const cur = info.data;
  const off = working || busy || !online;
  const set = async (input: Record<string, unknown>): Promise<Hook | null> => {
    setWorking(true);
    setSay(null);
    try {
      const out = (await d.call("sites.webhook_set", { siteId: site.siteId, ...input })) as Hook;
      if (out.secret) setSecret(out.secret);
      info.refresh();
      return out;
    } catch (e) {
      setSay(errorMessage(e));
      return null;
    } finally {
      setWorking(false);
    }
  };
  const copy = (text: string): void => {
    void (globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } }).navigator?.clipboard
      ?.writeText(text)
      .catch(() => undefined);
  };
  const typed = follow ?? (cur?.follow ?? []).join(", ");
  const list = parseFollow(typed);
  return (
    <Card title="GitHub webhook">
      <Text style={ui.text}>
        A push deploys at once instead of within a minute, and a branch can get its own preview. GitHub signs each
        delivery with a secret only this site knows.
      </Text>
      {cur === undefined || cur === null ? (
        <Text style={ui.text}>Reading</Text>
      ) : !cur.enabled ? (
        <Button title="Turn on" testID="site-hook-on" disabled={off} onPress={() => void set({ enabled: true })} />
      ) : (
        <>
          {secret ? (
            <View testID="site-hook-secret">
              <Row
                id="hook-secret"
                title="Secret"
                note={secret}
                trailing={<Button title="Copy" onPress={() => copy(secret)} />}
              />
              <Text style={ui.text}>Copy it now. It is not shown again.</Text>
            </View>
          ) : null}
          {cur.url ? (
            <Row
              id="hook-url"
              title="Payload URL"
              note={cur.url}
              trailing={<Button title="Copy" onPress={() => copy(cur.url as string)} />}
            />
          ) : null}
          <Text style={ui.text}>
            In the repo on GitHub: Settings, Webhooks, Add webhook. Content type application/json, the secret above, and
            the push and pull request events.
          </Text>
          <Text style={ui.text}>
            {cur.lastDeliveryAt ? `Last delivery ${ago(cur.lastDeliveryAt, d.clock().now)}.` : "Nothing received yet."}
          </Text>
          <TextInput
            accessibilityLabel="Branches that get a preview"
            testID="site-hook-follow"
            value={typed}
            onChangeText={setFollow}
            placeholder="Preview branches: feat/*, next"
            placeholderTextColor="var(--ink-4)"
            autoCapitalize="none"
            style={ui.input}
          />
          <View style={ui.actions}>
            <Button
              title="Save branches"
              testID="site-hook-save"
              disabled={off || follow === null}
              onPress={() => void set({ follow: list }).then((o) => o && setFollow(null))}
            />
            <Button
              title="New secret"
              testID="site-hook-rotate"
              disabled={off}
              onPress={() => void set({ rotate: true })}
            />
            <Button
              title="Turn off"
              testID="site-hook-off"
              disabled={off}
              onPress={() =>
                void set({ enabled: false }).then(() => {
                  setSecret(null);
                })
              }
            />
          </View>
        </>
      )}
      {say ? (
        <Text style={ui.text} testID="site-hook-say">
          {say}
        </Text>
      ) : null}
    </Card>
  );
}
