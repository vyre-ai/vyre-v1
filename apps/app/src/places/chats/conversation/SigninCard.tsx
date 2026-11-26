// The sign-in hand-off in a chat (rc.44; terminal.ask_signin and computers.browser.ask_signin, one card for both). An agent needs a person to finish a login in its terminal or its browser (a device code, a
// password, a CAPTCHA). The people who may take over that computer see Open terminal or Open browser (both open the agent's Computer tab, where its terminals and its browser are one press away and Take over is the button there) and the two answers; everyone else sees who the agent waits for, and no button. Done hands the computer back and the
// agent carries on; I can't says so. The sign-in itself is the take-over that already exists (the terminal's Take over, the browser's): nothing typed there passes through this card.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text } from "react-native";
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

export function SigninCard(p: SigninCardProps): ReactElement {
  const [who, setWho] = useState<Who>({ s: "reading" });
  const [done, setDone] = useState<string | null>(null);
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
  return (
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
                setDone("Could not sign in");
              },
              testID: `signin-card-cannot-${p.id}`,
            },
            {
              label: "Done",
              onPress: () => {
                p.answer(p.id, "done");
                setDone("Signed in. The agent carries on");
              },
              testID: `signin-card-done-btn-${p.id}`,
            },
          ]}
          primary={{
            label: p.surface === "terminal" ? "Open terminal" : "Open browser",
            onPress: () => p.openComputer(p.agentId),
            testID: `signin-card-open-${p.id}`,
          }}
        />
      )}
      <Text style={s.hint} accessibilityElementsHidden importantForAccessibility="no">
        {who.s === "may" ? `Take over the ${where}, sign in, then press Done.` : ""}
      </Text>
    </Card>
  );
}

const s = StyleSheet.create({
  why: { fontSize: 14, lineHeight: 20, color: "var(--ink)" as string },
  wait: { fontSize: 12.5, color: "var(--ink-3)" as string },
  hint: { fontSize: 12, color: "var(--ink-3)" as string, paddingHorizontal: 16, paddingBottom: 8 },
});
