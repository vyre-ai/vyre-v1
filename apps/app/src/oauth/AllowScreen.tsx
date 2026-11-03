// The Allow page: "Claude Code wants to join Northwind", who it acts for, what it can do, and one press. The same frame as every entry screen, because it is one (apps/app/src/join/kit.tsx). It is drawn in Vyre, where the person is
// already signed in, and the press is a capability call with their session (mcp.oauth.allow): no other site can send that, and no frame may hold this page. What the client says about itself is marked as its own words, and the host a
// code would go to is named when it is not this computer. After the press the tab that asked collects the sign-in by itself: this screen never holds a code.
import { spaceLabel } from "../shell/spaces/space-label.ts";
import { useEffect, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Text, View } from "react-native";
import type { CapMap } from "../../../../generated/types.ts";
import { Bar, Button, ErrorLine, JoinFrame, Links, Opening, Panel, Segments, Step, TextButton, Title, useJoin } from "../join/kit.tsx";

type Request = CapMap["mcp.oauth.request"]["out"]["request"];

export const SELF_DECLARED = "That name is what the app calls itself. Vyre has not checked it.";
export const CAN_DO = "It can do what you can here, and no more.";
export const STOPS = "Sends, posts and payments still wait for your yes.";
export const ONLY_YOU = "Only you can use it.";
export const YOURS = "Allow this only if you just connected this app yourself.";
/** The two choices of an owner or admin (owner ruling 3 Nov), and the one line that says what the first means. */
export const SETUP_TITLE = "Act for me";
export const ASK_TITLE = "Ask me first";
export const SETUP_LINE = "Act for me, including setup: it can set up sign-in, Connect your company, AI keys, Vault items, invites and Console settings as you, with no card. It never reads a secret back.";
export const ASK_LINE = "Anything only you can do here waits for your yes in Needs you.";

/** Words a request can end in. Everything that means "start again" reads the same. */
export function endedWords(e: unknown): string {
  const code = (e as { code?: string; error?: { code?: string } })?.code ?? (e as { error?: { code?: string } })?.error?.code;
  if (code === "permission.role_lacks_permission" || code === "permission.no_grant") return "Your role in this Space cannot add agents. Ask an admin.";
  return "This request has ended. Start again from the app you are connecting.";
}

/** A page in a frame is a page someone else can draw over. Nothing is offered there. */
export const framed = (g: { top?: unknown; self?: unknown } = globalThis as { top?: unknown; self?: unknown }): boolean => {
  try { return g.top !== undefined && g.top !== g.self; } catch { return true; }
};

function Fact({ children, warn, first, testID }: { children: string; warn?: boolean; first?: boolean; testID?: string }): ReactElement {
  const { p } = useJoin();
  return <Text {...(testID ? { testID } : {})} style={{ fontSize: 13.5, lineHeight: 18, color: warn ? p.danger : p.ink2, paddingVertical: 11, paddingHorizontal: 12, ...(first ? {} : { borderTopWidth: 1, borderTopColor: p.line }) }}>{children}</Text>;
}

function Facts({ children }: { children: ReactNode }): ReactElement {
  const { p } = useJoin();
  return <View testID="allow-facts" style={{ marginTop: 20, width: "100%", borderRadius: 12, backgroundColor: p.field, overflow: "hidden" }}>{children}</View>;
}

export interface AllowProps {
  call(cap: string, input: unknown): Promise<unknown>;
  requestId: string;
  /** Who is signed in here. */
  me: string;
  /** Back to whatever the person was doing. */
  onDone?: () => void;
}

export function AllowScreen({ call, requestId, me, onDone }: AllowProps): ReactElement {
  const [req, setReq] = useState<Request | null>(null);
  const [ended, setEnded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [answered, setAnswered] = useState<"allowed" | "declined" | null>(null);
  const [name, setName] = useState("");
  /** Set once the request is read: an owner or admin starts on "Act for me, including setup". */
  const [mode, setMode] = useState<"setup" | "ask" | null>(null);
  useEffect(() => {
    let live = true;
    void call("mcp.oauth.request", { requestId }).then((o) => { if (live) { const r = (o as CapMap["mcp.oauth.request"]["out"]).request; setReq({ ...r, spaceName: spaceLabel(r.spaceName, (globalThis as { location?: { origin?: string } }).location?.origin) }); } }, (e: unknown) => { if (live) setEnded(endedWords(e)); });
    return () => { live = false; };
  }, [call, requestId]);
  if (framed()) return <JoinFrame><Panel><Step id="allow-framed"><Title title="Open this in Vyre" sub="This page does not work inside another page." /></Step></Panel></JoinFrame>;
  if (ended) return <JoinFrame><Panel bar={<Bar cont={<Button label="Close" testID="allow-close" {...(onDone ? { onPress: onDone } : {})} />} />}><Step id="allow-ended"><Title title="This link ended" sub={ended} /></Step></Panel></JoinFrame>;
  if (!req) return <Opening title="Opening" testID="allow-loading" />;
  const choice = req.canSetup === true ? (mode ?? "setup") : "ask";
  if (answered === "allowed") return <JoinFrame><Panel bar={<Bar cont={<Button label="Done" testID="allow-done" {...(onDone ? { onPress: onDone } : {})} />} />}><Step id="allow-joined"><Title title={`${name} joined ${req.spaceName}`} sub="Go back to the app you were connecting. You can see what it does on its page." /></Step></Panel></JoinFrame>;
  if (answered === "declined") return <JoinFrame><Panel bar={<Bar cont={<Button label="Done" testID="allow-done" {...(onDone ? { onPress: onDone } : {})} />} />}><Step id="allow-declined"><Title title="Not allowed" sub={`${req.clientName} did not join.`} /></Step></Panel></JoinFrame>;
  const allow = (): void => {
    if (busy) return;
    setBusy(true);
    void call("mcp.oauth.allow", { requestId, ...(choice === "setup" ? { setup: true } : {}) }).then(
      (o) => { setName((o as CapMap["mcp.oauth.allow"]["out"]).name); setAnswered("allowed"); },
      (e: unknown) => { setEnded(endedWords(e)); setBusy(false); },
    );
  };
  const decline = (): void => { void call("mcp.oauth.decline", { requestId }).then(() => setAnswered("declined"), (e: unknown) => setEnded(endedWords(e))); };
  const away = req.redirectHost !== undefined;
  return (
    <JoinFrame>
      <Panel
        bar={<Bar cont={<Button label="Allow" testID="allow-allow" quiet={away} busy={busy} onPress={allow} />} />}
        below={<Links><TextButton label="Not now" testID="allow-decline" onPress={decline} /></Links>}
      >
        <Step id="allow">
          <Title title={`${req.clientName} wants to join ${req.spaceName}`} sub={SELF_DECLARED} />
          {req.canSetup === true ? (
            <View style={{ marginTop: 18, width: "100%" }}>
              <Segments label="What it may do" value={choice} onChange={setMode} options={[{ id: "setup", title: SETUP_TITLE, testID: "allow-mode-setup" }, { id: "ask", title: ASK_TITLE, testID: "allow-mode-ask" }]} />
            </View>
          ) : null}
          <Facts>
            {away ? <Fact warn first>{`When you allow this, it goes to ${req.redirectHost as string}, not an app on this computer.`}</Fact> : null}
            <Fact first={!away}>{`Acts for you, ${me}. ${ONLY_YOU}`}</Fact>
            <Fact>{CAN_DO}</Fact>
            {req.canSetup === true ? <Fact testID="allow-mode-line">{choice === "setup" ? SETUP_LINE : ASK_LINE}</Fact> : null}
            <Fact>{STOPS}</Fact>
            <Fact>{`Your browser tab shows this code: ${req.match}`}</Fact>
            <Fact>{YOURS}</Fact>
          </Facts>
          {busy ? null : <ErrorLine testID="allow-error" />}
        </Step>
      </Panel>
    </JoinFrame>
  );
}
