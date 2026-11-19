// /chrome/connect: the Space's own page for "Connect Chrome". Vyre for Chrome opened it with the hash of a value it keeps (#challenge=<64 hex>); the person is signed in here the way they always
// are, and one press makes a one-time pair code bound to that hash and hands it to the extension through this window (its content script on this path is the only listener, and the extension
// accepts it only from this Space's origin). The page never holds a session of the extension and never shows the code. It is drawn in Vyre where the person is signed in, and no frame may hold it.
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Bar, Button, ErrorLine, JoinFrame, Links, Opening, Panel, Step, TextButton, Title } from "../join/kit.tsx";
import { framed } from "../oauth/AllowScreen.tsx";

export const CHALLENGE = /^[0-9a-f]{64}$/;
/** The value in the address: only a well-formed hash, never anything else. */
export const challengeFrom = (hash: string): string | null => {
  const m = /^#challenge=([0-9a-fA-F]{64})$/.exec(hash);
  return m && CHALLENGE.test(m[1].toLowerCase()) ? m[1].toLowerCase() : null;
};

export const NOT_ANSWERED =
  "Vyre for Chrome did not answer. Open Vyre for Chrome in Chrome, choose Connect a Space and try again.";
export const ENDED = "This link ended. Start again from Vyre for Chrome.";
export const WAIT_MS = 6000;

export interface ConnectChromeProps {
  call(cap: string, input: unknown): Promise<unknown>;
  /** Hash of the address, "#challenge=<64 hex>". */
  hash: string;
  spaceName: string;
  /** Who is signed in here. */
  me: string;
  /** The window the extension listens on; a test hands its own. */
  win?: {
    postMessage(m: unknown, origin: string): void;
    addEventListener(t: "message", f: (e: { data?: unknown; origin?: string; source?: unknown }) => void): void;
    removeEventListener(t: "message", f: (e: { data?: unknown; origin?: string; source?: unknown }) => void): void;
    location: { origin: string };
  };
  onDone?: () => void;
  setTimer?: (f: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

type Phase = "ask" | "working" | "done" | "unanswered" | "declined" | "ended";

let seq = 0;

export function ConnectChromeScreen({
  call,
  hash,
  spaceName,
  me,
  win = globalThis as unknown as NonNullable<ConnectChromeProps["win"]>,
  onDone,
  setTimer = (f, ms) => setTimeout(f, ms),
  clearTimer = (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
}: ConnectChromeProps): ReactElement {
  const challenge = challengeFrom(hash);
  const [phase, setPhase] = useState<Phase>(challenge ? "ask" : "ended");
  const timer = useRef<unknown>(null);
  const listener = useRef<((e: { data?: unknown; origin?: string; source?: unknown }) => void) | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimer(timer.current);
      if (listener.current) win.removeEventListener("message", listener.current);
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );
  if (framed())
    return (
      <JoinFrame>
        <Panel>
          <Step id="chrome-framed">
            <Title title="Open this in Vyre" sub="This page does not work inside another page." />
          </Step>
        </Panel>
      </JoinFrame>
    );
  const close = (): void => {
    if (onDone) onDone();
  };
  const connect = (): void => {
    if (phase === "working" || !challenge) return;
    setPhase("working");
    void call("identity.pair_create", {
      purpose: "extension",
      challenge,
      idempotencyKey: `chrome-connect-${Date.now().toString(36)}-${++seq}`,
    }).then(
      (o) => {
        const code = (o as { code?: unknown }).code;
        if (typeof code !== "string") {
          setPhase("ended");
          return;
        }
        // the extension answers in this same window and no other: its reply is accepted only from here
        const on = (e: { data?: unknown; origin?: string; source?: unknown }): void => {
          const d = e.data as { type?: string; ok?: boolean } | undefined;
          if (e.source !== win || e.origin !== win.location.origin || !d || d.type !== "vyre.chrome.linked") return;
          win.removeEventListener("message", on);
          listener.current = null;
          if (timer.current) clearTimer(timer.current);
          setPhase(d.ok ? "done" : "unanswered");
        };
        listener.current = on;
        win.addEventListener("message", on);
        timer.current = setTimer(() => {
          win.removeEventListener("message", on);
          listener.current = null;
          setPhase("unanswered");
        }, WAIT_MS);
        win.postMessage({ type: "vyre.chrome.code", code }, win.location.origin);
      },
      () => setPhase("ended"),
    );
  };
  if (phase === "ended")
    return (
      <JoinFrame>
        <Panel bar={<Bar cont={<Button label="Close" testID="chrome-close" onPress={close} />} />}>
          <Step id="chrome-ended">
            <Title title="This link ended" sub={ENDED} />
          </Step>
        </Panel>
      </JoinFrame>
    );
  if (phase === "done")
    return (
      <JoinFrame>
        <Panel bar={<Bar cont={<Button label="Close this tab" testID="chrome-done" onPress={close} />} />}>
          <Step id="chrome-connected">
            <Title
              title={`Connected to ${spaceName}`}
              sub="Vyre for Chrome is ready. It is listed under Settings, Sign-in and devices; sign it out there any time."
            />
          </Step>
        </Panel>
      </JoinFrame>
    );
  if (phase === "declined")
    return (
      <JoinFrame>
        <Panel bar={<Bar cont={<Button label="Close" testID="chrome-close" onPress={close} />} />}>
          <Step id="chrome-declined">
            <Title title="Not connected" sub="Chrome was not connected to this Space." />
          </Step>
        </Panel>
      </JoinFrame>
    );
  if (phase === "working") return <Opening title="Connecting" testID="chrome-working" />;
  return (
    <JoinFrame>
      <Panel
        bar={<Bar cont={<Button label="Connect" testID="chrome-connect" onPress={connect} />} />}
        below={
          <Links>
            <TextButton
              label="Not now"
              testID="chrome-decline"
              onPress={() => {
                setPhase("declined");
              }}
            />
          </Links>
        }
      >
        <Step id="chrome-ask">
          <Title
            title={`Connect Chrome to ${spaceName}`}
            sub={`${me}. Chat beside any page, fill from your Vault, and agents when you allow it.`}
          />
          {phase === "unanswered" ? <ErrorLine testID="chrome-unanswered">{NOT_ANSWERED}</ErrorLine> : null}
        </Step>
      </Panel>
    </JoinFrame>
  );
}
