// Getting in (rc.41): the three screens that keep every way into a Space from ending on a dead line. Your Spaces lists the Spaces this device has used, one press each. NotAnswering is the
// one failure screen for a Space that could not be reached: what happened, in the Space's name, with the fix as a button. InBrowser is a Space on Vyre's relay that the desktop app opened in
// the browser for the person. Prototype: vyre-install.html, States, "Getting in".
import { useEffect, useRef } from "react";
import type { ReactElement } from "react";
import { View } from "react-native";
import { Bar, Button, Door, Fixes, JoinFrame, Panel, QuietLine, SpaceFace, Step, Title } from "./kit.tsx";
import { NOT_ANSWERING_SUB, RECONNECTING, notAnswering } from "./failure.ts";
import { spaceHost } from "../shell/spaces/space-label.ts";
import type { SpaceRow } from "../shell/session/known-spaces.ts";

/** What a row says under the Space's name: whose account, where it runs, or what pressing it does. */
export function rowHint(row: SpaceRow): string {
  if (row.state === "browser") return "In your browser";
  if (row.state === "out") return "Sign in";
  if (row.kind === "personal") return "On this computer";
  return row.person ?? row.username ?? spaceHost(row.address);
}

export function YourSpaces({
  rows,
  reconnecting,
  onOpen,
  onAdd,
}: {
  rows: readonly SpaceRow[];
  /** The address of the row being reached again, quietly, after its first try got no answer. */ reconnecting?:
    | string
    | null;
  onOpen(row: SpaceRow): void;
  onAdd(): void;
}): ReactElement {
  const sel = useRef(-1);
  useEffect(() => {
    const doc = (globalThis as { document?: Document }).document;
    if (!doc) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey || reconnecting) return;
      const t = e.target as { tagName?: string } | null;
      if (t?.tagName === "INPUT" || t?.tagName === "TEXTAREA") return;
      const n = Number(e.key);
      if (n >= 1 && n <= Math.min(9, rows.length)) {
        e.preventDefault();
        onOpen(rows[n - 1]!);
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const els = Array.from(
          doc.querySelectorAll<HTMLElement>("[data-testid^='your-space-'], [data-testid='add-space']"),
        );
        if (els.length === 0) return;
        sel.current = (sel.current + (e.key === "ArrowDown" ? 1 : -1) + els.length) % els.length;
        els[sel.current]?.focus();
      }
    };
    doc.addEventListener("keydown", onKey);
    return () => doc.removeEventListener("keydown", onKey);
  }, [rows, reconnecting, onOpen]);
  // one row per Space: built in a loop, not a list of rows
  const list: ReactElement[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    list.push(
      <Door
        key={row.address}
        testID={`your-space-${i}`}
        icon="team"
        lead={<SpaceFace name={row.name} image={row.image} person={row.person} quiet={row.state === "out"} />}
        title={row.name}
        hint={rowHint(row)}
        {...(i < 9 ? { n: String(i + 1) } : {})}
        {...(row.state === "browser" ? { out: true } : {})}
        {...(reconnecting === row.address ? { status: RECONNECTING } : {})}
        disabled={!!reconnecting && reconnecting !== row.address}
        onPress={() => onOpen(row)}
      />,
    );
  }
  return (
    <JoinFrame>
      <Panel>
        <Step id="your-spaces">
          <Title title="Your Spaces" />
          <View testID="your-spaces" accessibilityLabel="Your Spaces" style={{ gap: 6, marginTop: 22 }}>
            {list}
            <Door testID="add-space" icon="plus" title="Add a Space" light disabled={!!reconnecting} onPress={onAdd} />
          </View>
        </Step>
      </Panel>
    </JoinFrame>
  );
}

/**
 * A Space that could not be reached, after the quiet retries: its name, what that means, Try again, and under it the fixes that fit where the person is (Clear old data in a browser that
 * holds some, Open in browser in the desktop app). While `reconnecting` the same sheet says so and nothing can be pressed twice.
 */
export function NotAnswering({
  space,
  title,
  sub,
  reconnecting,
  checking,
  onRetry,
  onClear,
  onBrowser,
  onOther,
  otherLabel,
  onBack,
}: {
  space: string;
  title?: string;
  sub?: string;
  reconnecting?: boolean;
  /** The screen is asking again by itself every few seconds (a relay Space that is asleep). */ checking?: boolean;
  onRetry(): void;
  /** Remove this browser's old worker and cached pages for the Space; the saved sign-in stays. */ onClear?:
    | (() => void)
    | undefined;
  onBrowser?: (() => void) | undefined;
  /** One more way on, in the words given (Use a different account). */ onOther?: (() => void) | undefined;
  otherLabel?: string;
  onBack?: (() => void) | undefined;
}): ReactElement {
  return (
    <JoinFrame>
      <Panel
        space={space}
        bar={
          <Bar
            {...(onBack ? { onBack } : {})}
            cont={
              <Button
                testID="not-answering-retry"
                label="Try again"
                busy={!!reconnecting}
                onPress={onRetry}
                disabled={!!reconnecting}
              />
            }
          />
        }
        below={
          <Fixes>
            {onClear ? (
              <Button
                quiet
                icon="redo"
                testID="not-answering-clear"
                label="Clear old data"
                disabled={!!reconnecting}
                onPress={onClear}
              />
            ) : null}
            {onBrowser ? (
              <Button
                quiet
                icon="globe"
                testID="not-answering-browser"
                label="Open in browser"
                disabled={!!reconnecting}
                onPress={onBrowser}
              />
            ) : null}
            {onOther && otherLabel ? (
              <Button
                quiet
                icon="person"
                testID="not-answering-other"
                label={otherLabel}
                disabled={!!reconnecting}
                onPress={onOther}
              />
            ) : null}
          </Fixes>
        }
      >
        <Step id="not-answering">
          <Title title={title ?? notAnswering(space)} sub={sub ?? NOT_ANSWERING_SUB} />
          <View style={{ flexGrow: 1, minHeight: 24 }} />
          {reconnecting ? (
            <QuietLine testID="not-answering-line">{RECONNECTING}</QuietLine>
          ) : checking ? (
            <QuietLine testID="not-answering-line">Checking</QuietLine>
          ) : (
            <View style={{ minHeight: 28 }} />
          )}
        </Step>
      </Panel>
    </JoinFrame>
  );
}

/** A Space on Vyre's relay, opened in the browser by the desktop app. It stays in Your Spaces; Open again opens it there once more. */
export function InBrowser({
  space,
  onAgain,
  onBack,
}: {
  space: string;
  onAgain(): void;
  onBack(): void;
}): ReactElement {
  return (
    <JoinFrame>
      <Panel
        space={space}
        bar={
          <Bar onBack={onBack} cont={<Button quiet testID="in-browser-again" label="Open again" onPress={onAgain} />} />
        }
      >
        <Step id="in-browser">
          <Title title={`${space} is open in your browser`} sub="It stays in Your Spaces" />
          <View style={{ flexGrow: 1, minHeight: 24 }} />
        </Step>
      </Panel>
    </JoinFrame>
  );
}
