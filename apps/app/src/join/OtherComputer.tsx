// Sign in on a new computer with the Vyre account you already use (lane l-multidevice, owner ruling 3 Nov): one Personal Space on all of a person's computers. The app asks for the username and
// password, finds the Personal Space on the person's other computer through the relay, and offers "Use your Personal Space from <name>". The other computer shows the request with the same six
// digits; once the person allows it there, this computer gets the account's key bundle and opens it with the password here. Only the person's own Space can have made a bundle that password
// opens, so a stranger who answered for the name is caught before anything is copied. Then the Space is copied once and stays in sync.
// No Personal Space answered: the other computer is asleep, offline, or has no Vyre open. The screen says so, and the person can still sign in to a Space by its address.
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { loadCryptoKeys } from "../../../../client/src/crypto/load.ts";
import { createPeerJoin } from "../../../../client/src/connection/peers.ts";
import type { PeerJoin, PeerOffer } from "../../../../client/src/connection/peers.ts";
import { Bar, Button, Choice, CodeShown, ErrorLine, Field, Group, Links, Panel, QuietLine, Step, TextButton, Title, Working } from "./kit.tsx";

export const NONE_ANSWERED = "None of your computers answered. Open Vyre on your other computer, keep it awake and online, and try again.";
export const WRONG_PASSWORD = "That password does not open this Personal Space. Check it and try again.";
const POLL_MS = 2_000;

type Phase =
  | { kind: "ask" }
  | { kind: "found"; offers: PeerOffer[] }
  | { kind: "waiting"; from: string; code: string }
  | { kind: "check"; from: string; bundle: unknown }
  | { kind: "copying"; from: string };

export interface OtherComputerProps {
  /** Start this computer's own (fresh) Personal Space and say where it answers. */
  startLocal(): Promise<{ address: string }>;
  /** The copy is in place and the Space restarts on it: sign in there with the same username and password, once, so the person is not asked again. */
  onJoined(o: { space: string; username: string; password: string }): void;
  /** Sign in to a Space by its address instead. */
  onAddress(): void;
  onBack?: (() => void) | undefined;
  /** what this computer calls itself to the other one */
  deviceName?: string;
  /** tests */
  join?: PeerJoin;
  pollMs?: number;
}

export function OtherComputer({ startLocal, onJoined, onAddress, onBack, deviceName, join: given, pollMs = POLL_MS }: OtherComputerProps): ReactElement {
  const [phase, setPhase] = useState<Phase>({ kind: "ask" });
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const join = useRef<PeerJoin | null>(given ?? null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const client = async (): Promise<PeerJoin> => {
    if (join.current) return join.current;
    const local = await startLocal();
    join.current = createPeerJoin(local.address);
    return join.current;
  };
  // a ref, not the state: the poll below calls `check` from the render that started it
  const working = useRef(false);
  const run = async (step: () => Promise<void>): Promise<void> => {
    if (working.current) return;
    working.current = true;
    setBusy(true); setError("");
    try { await step(); } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "That did not work. Try again."); } finally { working.current = false; if (alive.current) setBusy(false); }
  };

  const find = (): Promise<void> => run(async () => {
    const offers = await (await client()).find(username.trim());
    if (!alive.current) return;
    if (!offers.length) { setError(NONE_ANSWERED); return; }
    setPhase({ kind: "found", offers });
  });
  const use = (o: PeerOffer): Promise<void> => run(async () => {
    const r = await (await client()).request(o.index, deviceName);
    if (alive.current) setPhase({ kind: "waiting", from: r.name, code: r.code });
  });
  const check = (bundle: unknown, from: string): Promise<void> => run(async () => {
    const b = bundle as { personKeyByPassword?: unknown; personKeyByRecovery?: string; publicKey?: string; privateKeyWrapped?: string } | null;
    try {
      if (!b || typeof b.personKeyByPassword !== "string") throw new Error("no bundle");
      const { openBundle } = await loadCryptoKeys();
      await openBundle(password, { personKeyByPassword: b.personKeyByPassword, personKeyByRecovery: b.personKeyByRecovery ?? "", publicKey: b.publicKey ?? "", privateKeyWrapped: b.privateKeyWrapped ?? "" });
    } catch { if (alive.current) { setPhase({ kind: "check", from, bundle }); setError(WRONG_PASSWORD); } return; }
    if (!alive.current) return;
    setPhase({ kind: "copying", from });
    const done = await (await client()).commit();
    if (alive.current) onJoined({ space: done.space, username: username.trim(), password });
  });

  // waiting for the person to allow this computer on the other one
  useEffect(() => {
    if (phase.kind !== "waiting") return;
    let stop = false;
    const tick = async (): Promise<void> => {
      if (stop) return;
      try {
        const s = await (await client()).status();
        if (stop || !alive.current) return;
        if (s.state === "allowed") { void check(s.bundle, s.from); return; }
        if (s.state === "declined") { setPhase({ kind: "ask" }); setError(`${s.from} turned this computer away.`); return; }
        if (s.state === "expired") { setPhase({ kind: "ask" }); setError("The request ran out of time. Try again."); return; }
      } catch { /* the other computer went quiet for a moment; keep asking */ }
      if (!stop) setTimeout(() => void tick(), pollMs);
    };
    const t = setTimeout(() => void tick(), pollMs);
    return () => { stop = true; clearTimeout(t); };
  }, [phase]);   // eslint-disable-line react-hooks/exhaustive-deps

  const back = onBack ? { onBack: () => { void join.current?.cancel(); onBack(); } } : {};

  if (phase.kind === "copying") {
    return <Panel wait><Step id="peer-copying"><Working testID="peer-copying" title="Copying your Personal Space" line={`From ${phase.from}. Your chats, files and records come over once, then stay in sync.`} /></Step></Panel>;
  }
  if (phase.kind === "waiting") {
    return (
      <Panel bar={<Bar {...back} cont={<Button testID="peer-cancel" quiet label="Cancel" onPress={() => { void join.current?.cancel(); setPhase({ kind: "ask" }); }} />} />}>
        <Step id="peer-waiting">
          <Title title={`Allow this computer on ${phase.from}`} sub={`On ${phase.from}, open Settings, then Computers, and allow this computer. Check that it shows the same code.`} />
          <CodeShown testID="peer-code" code={phase.code} />
          <QuietLine testID="peer-waiting-line">{`Waiting for ${phase.from}`}</QuietLine>
          <ErrorLine testID="peer-error" collapse>{error}</ErrorLine>
        </Step>
      </Panel>
    );
  }
  if (phase.kind === "found") {
    const rows: ReactElement[] = [];
    for (const o of phase.offers) rows.push(<Choice key={o.index} testID={`peer-offer-${o.index}`} icon="laptop" title={`Use your Personal Space from ${o.name}`} help="Your chats, files and records, on this computer too" busy={busy} disabled={busy} onPress={() => void use(o)} />);
    return (
      <Panel bar={<Bar onBack={() => setPhase({ kind: "ask" })} cont={null} />}>
        <Step id="peer-found">
          <Title title="Your Personal Space" />
          <Group>{rows}</Group>
          <ErrorLine testID="peer-error" collapse>{error}</ErrorLine>
        </Step>
      </Panel>
    );
  }
  const checking = phase.kind === "check";
  const ready = username.trim().length > 0 && password.length > 0 && !busy;
  const go = (): void => { if (!ready) return; if (checking) void check(phase.bundle, phase.from); else void find(); };
  return (
    <Panel
      below={<Links><TextButton testID="peer-address" label="Sign in to a Space by its address" disabled={busy} onPress={onAddress} /></Links>}
      bar={<Bar {...back} cont={<Button testID="peer-find" label={busy ? "Looking for your other computer" : checking ? "Continue" : "Find my Personal Space"} busy={busy} disabled={!ready} onPress={go} />} />}
    >
      <Step id="peer-ask">
        <Title title="Sign in with your Vyre account" sub="Use the same Personal Space you have on your other computer." />
        <Group>
          <Field testID="peer-username" label="Username" value={username} onChange={(v) => { setUsername(v); setError(""); }} autoComplete="username" autoFocus disabled={checking} />
          <Field testID="peer-password" label="Password" value={password} onChange={(v) => { setPassword(v); setError(""); }} secure autoComplete="current-password" onSubmit={go} error={error === WRONG_PASSWORD} />
        </Group>
        <ErrorLine testID="peer-error">{error}</ErrorLine>
      </Step>
    </Panel>
  );
}
