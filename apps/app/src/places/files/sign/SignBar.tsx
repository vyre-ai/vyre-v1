// The quiet line a file (and a record) shows about its signature request: Waiting for Andrea, Signed on 14 Nov, Andrea declined. Remind, Copy link and Cancel are one press away; the signed copy opens in the viewer.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Dialog } from "../../../../../../ui/src/Dialog/index.tsx";
import { Status } from "../../../../../../ui/src/Status/index.tsx";
import { cancelRequest, remind, sayError } from "./actions.ts";
import type { Sent } from "./actions.ts";
import { useSignData } from "./data.tsx";
import { LinkRows } from "./SignSheet.tsx";
import { first, isOpen, mailWords, statusLine } from "./model.ts";
import type { Envelope } from "./model.ts";

const originOf = (): string => (globalThis as { location?: { origin?: string } }).location?.origin ?? "";

export function SignBar({
  env,
  onChange,
  onSendAgain,
  testID = "sign-bar",
}: {
  env: Envelope;
  /** The request changed (cancelled, reminded): read it again. */
  onChange(): void;
  /** Declined or cancelled: send it again opens the sheet. */
  onSendAgain?(): void;
  testID?: string;
}): ReactElement {
  const d = useSignData();
  const [links, setLinks] = useState<Sent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const clock = d.clock();
  const line = statusLine(env, clock.now, clock.offsetMin ?? 0);
  const open = isOpen(env);
  const toSign = env.signers
    .map((s, i) => ({ s, i }))
    .filter((x) => x.s.state !== "signed" && x.s.state !== "declined");
  const say = (t: string): void => d.say?.(t);
  const getLinks = (): void => {
    setError(null);
    void Promise.all(toSign.map((x) => remind(d.call, env.id, x.i, d.origin ?? originOf()))).then(
      (all) => {
        const got = all.flatMap((a) => (a ? a.links : []));
        setLinks({
          id: env.id,
          links: got,
          emailed: all.flatMap((a) => a?.emailed ?? []),
          notice: all.find((a) => a?.notice)?.notice ?? null,
        });
        onChange();
      },
      (e: unknown) => setError(sayError(e)),
    );
  };
  const nudge = (): void => {
    setError(null);
    void Promise.all(toSign.map((x) => remind(d.call, env.id, x.i, d.origin ?? originOf()))).then(
      (all) => {
        const mailed = all.flatMap((a) => a?.emailed ?? []);
        if (mailed.length > 0) say(`Reminded ${toSign.map((x) => first(x.s.name)).join(" and ")}`);
        else {
          // no mail went out: the new links are the reminder, so show them
          setLinks({
            id: env.id,
            links: all.flatMap((a) => (a ? a.links : [])),
            emailed: [],
            notice: all.find((a) => a?.notice)?.notice ?? null,
          });
        }
        onChange();
      },
      (e: unknown) => setError(sayError(e)),
    );
  };
  const cancel = (): void => {
    setError(null);
    void cancelRequest(d.call, env.id).then(
      () => {
        say("Request cancelled");
        onChange();
      },
      (e: unknown) => setError(sayError(e)),
    );
  };
  const reason = env.state === "declined" && env.declinedReason ? `"${env.declinedReason}"` : undefined;
  const primary = open
    ? { label: "Remind", onPress: nudge }
    : env.state === "signed" && env.signedFileId && d.openFile
      ? { label: "Open signed copy", onPress: () => d.openFile?.(env.signedFileId as string) }
      : onSendAgain && (env.state === "declined" || env.state === "cancelled" || env.state === "expired")
        ? { label: "Send again", onPress: onSendAgain }
        : undefined;
  const second = open ? { label: "Copy link", onPress: getLinks } : undefined;
  return (
    <View style={st.wrap} testID={testID}>
      <Status
        tone={line.tone}
        label={line.label}
        {...((reason ?? line.note) ? { note: (reason ?? line.note) as string } : {})}
        {...(primary ? { action: primary } : {})}
        {...(second ? { alt: second } : {})}
        menu={[
          ...(open
            ? [
                { label: "Remind", onSelect: nudge },
                { label: "Copy link", onSelect: getLinks },
                { separator: true as const },
                { label: "Cancel request", onSelect: cancel },
              ]
            : []),
          ...(env.state === "signed" && env.signedFileId && d.openFile
            ? [{ label: "Open signed copy", onSelect: () => d.openFile?.(env.signedFileId as string) }]
            : []),
        ]}
        testID={`${testID}-status`}
      />
      {open ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel request"
          onPress={cancel}
          testID={`${testID}-cancel`}
          style={({ hovered }: { hovered?: boolean }) => [st.cancelBtn, hovered === true && st.over]}
        >
          <Text style={st.cancel}>Cancel request</Text>
        </Pressable>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" role="alert" style={st.error} testID={`${testID}-error`}>
          {error}
        </Text>
      ) : null}
      {links ? (
        <Dialog
          title="Links"
          onClose={() => setLinks(null)}
          width={520}
          fill
          testID="sign-links"
          note="Each press makes a new link and the old one stops working."
          actions={[{ label: "Done", primary: true, onPress: () => setLinks(null), testID: "sign-links-done" }]}
        >
          <View style={st.stack}>
            <Text style={st.said}>{mailWords(links.emailed, links.notice, links.links.length)}</Text>
            <LinkRows links={links.links} />
          </View>
        </Dialog>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingTop: 6 },
  cancelBtn: {
    alignSelf: "flex-start",
    marginLeft: 8,
    marginBottom: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  cancel: { fontSize: 12.5, color: "var(--ink-3)" as string },
  over: { backgroundColor: "var(--hover)" as string },
  error: { fontSize: 12.5, color: "var(--danger)" as string, marginLeft: 16, marginBottom: 6 },
  stack: { gap: 10 },
  said: { fontSize: 13, lineHeight: 19, color: "var(--ink-2)" as string },
});
