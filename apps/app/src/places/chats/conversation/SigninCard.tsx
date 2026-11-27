// The sign-in hand-off in a chat (rc.44; terminal.ask_signin and computers.browser.ask_signin, one card for both). An agent needs a person to finish a login in its terminal or its browser (a device code, a
// password, a CAPTCHA). The people who may take over that computer see Open terminal or Open browser (both open the agent's Computer tab, where its terminals and its browser are one press away and Take over is the button there) and the two answers; everyone else sees who the agent waits for, and no button. Done hands the computer back and the
// agent carries on; I can't says so. The sign-in itself is the take-over that already exists (the terminal's Take over, the browser's): nothing typed there passes through this card.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text } from "react-native";
import { TerminalSheet } from "../rightpane/TerminalSheet.tsx";
import type { TerminalData } from "../terminal/data.ts";
import { useWhenText } from "../../../../../../ui/src/Time/index.tsx";
import { Card, CardActions, CardBody, CardDone, CardHead } from "../../../../../../ui/src/Card/index.tsx";

export interface SigninCardProps {
  id: string;
  /** What the agent needs signed in to, in its words. */
  why: string;
  surface: "terminal" | "browser";
  agentId: string;
  terminalId?: string | undefined;
  site?: string | undefined;
  name: string;
  /** Capabilities as the person (computers.browser.profiles, agents.share_class). */
  call(cap: string, input: unknown): Promise<unknown>;
  me: string;
  nameOf(id: string): string;
  openComputer(agentId: string): void;
  /** What the full-screen terminal needs (the chat's own calls, connection and clock); left out where the shell has no terminal: Open terminal then opens the agent's Computer tab. */
  terminal?: TerminalData | undefined;
  /** When the card was answered, for "Olivia signed in, 11:09 PM". */
  answer(id: string, answer: unknown): void;
}

/** Who may take over this agent's computer, as the card shows it: yes, no (with whom the agent waits for), or unknown while it is being read. */
export type Who = { s: "reading" } | { s: "may" } | { s: "wait"; for: string };

/** The people who may take over are its owner and the admins (the Space browser's own rule, sbrowser/policy.ts). The profile row says it for this person; an agent whose browser has not started has no row, and its owner is read from how it is shared. */
export async function whoMayTakeOver(
  call: SigninCardProps["call"],
  agentId: string,
  me: string,
  nameOf: (id: string) => string,
): Promise<Who> {
  try {
    const rows =
      ((await call("computers.browser.profiles", {})) as { profiles?: Array<{ agentId: string; access?: string }> })
        .profiles ?? [];
    const mine = rows.find((r) => r.agentId === agentId);
    if (mine?.access === "owner" || mine?.access === "admin") return { s: "may" };
    const c = (await call("agents.share_class", { agentId })) as { ownerId?: string };
    if (c.ownerId === me) return { s: "may" };
    return { s: "wait", for: c.ownerId ? nameOf(c.ownerId) : "the owner" };
  } catch {
    // when it cannot be told the card offers nothing it cannot back: the server refuses a take-over by someone who may not, so an unreadable answer shows the waiting line
    return { s: "wait", for: "the owner" };
  }
}

/** The collapsed card of one that was answered: "Olivia signed in, 11:09 PM" or "Olivia couldn't sign in, 11:09 PM" (not the raw answer key). `when` is the Space's own time words (ui/Time). */
export function signinDoneLine(
  d: Record<string, unknown>,
  me: string,
  nameOf: (id: string) => string,
  when: (at: number, now: number) => string,
): string {
  const by = typeof d["answeredBy"] === "string" && d["answeredBy"] !== "" ? (d["answeredBy"] as string) : me;
  const at = typeof d["answeredAt"] === "number" ? `, ${when(d["answeredAt"] as number, Date.now())}` : "";
  return `${nameOf(by)} ${d["answer"] === "cannot" ? "couldn't sign in" : "signed in"}${at}`;
}

/** An answered sign-in card in a chat: one plain line. */
export function SigninDone({
  id,
  data,
  me,
  nameOf,
}: {
  id: string;
  data: Record<string, unknown>;
  me: string;
  nameOf: (id: string) => string;
}): ReactElement {
  const when = useWhenText();
  return <CardDone testID={`signin-card-done-${id}`} text={signinDoneLine(data, me, nameOf, when)} />;
}

export function SigninCard(p: SigninCardProps): ReactElement {
  const [who, setWho] = useState<Who>({ s: "reading" });
  const when = useWhenText();
  const [done, setDone] = useState<string | null>(null);
  const [sheet, setSheet] = useState<{ takeOver: boolean } | null>(null);
  useEffect(() => {
    let live = true;
    void whoMayTakeOver(p.call, p.agentId, p.me, p.nameOf).then((w) => {
      if (live) setWho(w);
    });
    return () => {
      live = false;
    };
    // the lookups are the card's own and do not change while it is shown
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.agentId, p.me]);
  if (done !== null) return <CardDone testID={`signin-card-done-${p.id}`} text={done} />;
  const where = p.surface === "terminal" ? "terminal" : "browser";
  const title = p.site ? `${p.why} (${p.site})` : p.why;
  const sheetEl =
    sheet !== null && p.terminal !== undefined && p.terminalId !== undefined ? (
      <TerminalSheet
        data={p.terminal}
        agentName={p.name}
        asleep={false}
        watchOnly={!sheet.takeOver}
        sessions={[{ name: "terminal", terminalId: p.terminalId, state: "idle", owner: { kind: "agent" } }]}
        start={p.terminalId}
        me={p.me}
        nameOf={p.nameOf}
        onClose={() => setSheet(null)}
      />
    ) : null;
  return (
    <>
      {sheetEl}
      <Card kind="decision" testID={`signin-card-${p.id}`} label={p.why}>
        <CardHead title={`${p.name} needs you to sign in`} />
        <CardBody>
          <Text testID={`signin-card-why-${p.id}`} style={s.why}>
            {title}
          </Text>
        </CardBody>
        {who.s === "wait" ? (
          <CardActions
            note={<Text testID={`signin-card-wait-${p.id}`} style={s.wait}>{`Waiting for ${who.for} to sign in`}</Text>}
          />
        ) : (
          <CardActions
            secondary={[
              {
                label: "I can't",
                onPress: () => {
                  p.answer(p.id, "cannot");
                  setDone(`${p.nameOf(p.me)} couldn't sign in, ${when(Date.now(), Date.now())}`);
                },
                testID: `signin-card-cannot-${p.id}`,
              },
              {
                label: "Done",
                onPress: () => {
                  p.answer(p.id, "done");
                  setDone(`${p.nameOf(p.me)} signed in, ${when(Date.now(), Date.now())}`);
                },
                testID: `signin-card-done-btn-${p.id}`,
              },
            ]}
            primary={{
              label: p.surface === "terminal" ? "Open terminal" : "Open browser",
              onPress: () => {
                // Open terminal opens THAT terminal, full screen, where Take over is the button; with no terminal to open it falls back to the agent's Computer tab
                if (p.surface === "terminal" && p.terminalId !== undefined && p.terminal) {
                  void Promise.resolve(p.call("terminal.workspace", { agentId: p.agentId }))
                    .then((w) => setSheet({ takeOver: (w as { takeOver?: boolean }).takeOver !== false }))
                    .catch(() => setSheet({ takeOver: true }));
                } else p.openComputer(p.agentId);
              },
              testID: `signin-card-open-${p.id}`,
            }}
          />
        )}
        <Text style={s.hint} accessibilityElementsHidden importantForAccessibility="no">
          {who.s === "may" ? `Take over the ${where}, sign in, then press Done.` : ""}
        </Text>
      </Card>
    </>
  );
}

const s = StyleSheet.create({
  why: { fontSize: 14, lineHeight: 20, color: "var(--ink)" as string },
  wait: { fontSize: 12.5, color: "var(--ink-3)" as string },
  hint: { fontSize: 12, color: "var(--ink-3)" as string, paddingHorizontal: 16, paddingBottom: 8 },
});
