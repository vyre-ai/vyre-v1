// Settings > Computers, in a Personal Space (lane l-multidevice): every computer that holds this Personal Space, which one is this computer, which are awake and when each was last seen, and
// a new computer asking to use it. A request shows the six digits the new computer's own screen shows; Allow gives that computer a full copy that stays in sync. The list asks again every
// few seconds while it is open, so a request made on the other computer appears here while the person is looking.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import { useSettingsData } from "./data.tsx";
import { Section, SettingsRow, SmallButton, Tip } from "./ui.tsx";

export interface PeerRow { peerId: string; name: string; platform: string; kind: "computer" | "server"; self: boolean; online: boolean; lastSeenAt?: number; addedAt: number }
export interface PeerRequestRow { requestId: string; name: string; platform: string; code: string; requestedAt: number; expiresAt: number }
export interface PeerConflictRow { conflictId: string; table: string; rowKey: string; kind: "renamed" | "kept_aside"; detail: string; at: number }

const POLL_MS = 4000;
export const ADD_HELP = "To add a computer, open Vyre on it and sign in with your Vyre account. It asks here, with a code to check.";

function Dot({ on, why }: { on: boolean; why?: string }): ReactElement {
  return <Tip help={why}><View accessibilityLabel={on ? "Online" : "Offline"} testID={on ? "dot-on" : "dot-off"} style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: (on ? "var(--ok, #2f9e5b)" : "var(--ink-4)") as string }} /></Tip>;
}

export function whenLabel(at: number | undefined, now: number): string {
  if (at === undefined) return "never";
  const min = Math.max(0, Math.round((now - at) / 60_000));
  if (min < 2) return "just now";
  if (min < 60) return `${min} minutes ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} ${h === 1 ? "hour" : "hours"} ago`;
  const d = Math.round(h / 24);
  return `${d} ${d === 1 ? "day" : "days"} ago`;
}

/** One line under a computer's name: this computer, awake, or when it was last seen. */
export function peerLine(p: PeerRow, now: number, runs = false): string {
  const line = peerState(p, now);
  return runs ? `${line} · runs scheduled work` : line;
}
function peerState(p: PeerRow, now: number): string {
  if (p.self) return "This computer";
  if (p.online) return p.kind === "server" ? "Server, on" : "Awake";
  return `Asleep · last seen ${whenLabel(p.lastSeenAt, now)}`;
}

export interface PeersBodyProps {
  peers: readonly PeerRow[];
  requests: readonly PeerRequestRow[];
  conflicts?: readonly PeerConflictRow[];
  /** the computer that runs scheduled automations and nightly jobs now */
  runner?: string | null;
  now: number;
  busy: boolean;
  removing: string | null;
  error: string;
  onAllow(requestId: string): void;
  onDecline(requestId: string): void;
  onAskRemove(peerId: string | null): void;
  onRemove(peerId: string): void;
}

export function PeersBody({ peers, requests, conflicts = [], runner = null, now, busy, removing, error, onAllow, onDecline, onAskRemove, onRemove }: PeersBodyProps): ReactElement {
  const rows: ReactElement[] = [];
  for (const r of requests) {
    rows.push(
      <SettingsRow
        key={`req-${r.requestId}`} id={`peer.request.${r.requestId}`} first={rows.length === 0} label={`${r.name} wants to use this Personal Space`} sub={`Check that it shows ${r.code}`}
        lead={<Dot on={false} why="Waiting for you" />}
        control={<>
          <SmallButton label="Decline" testID={`peer-decline-${r.requestId}`} disabled={busy} onPress={() => onDecline(r.requestId)} />
          <SmallButton label="Allow" testID={`peer-allow-${r.requestId}`} disabled={busy} onPress={() => onAllow(r.requestId)} />
        </>}
      />,
    );
  }
  for (const p of peers) {
    const sure = removing === p.peerId;
    rows.push(
      <SettingsRow
        key={p.peerId} id={`peer.${p.peerId}`} first={rows.length === 0} label={p.name} sub={peerLine(p, now, peers.length > 1 && runner === p.peerId)} lead={<Dot on={p.online} {...(p.online ? {} : { why: "Asleep or offline" })} />}
        {...(p.self ? {} : {
          control: sure ? (
            <>
              <SmallButton label="Cancel" onPress={() => onAskRemove(null)} />
              <SmallButton label="Remove" danger testID={`peer-remove-yes-${p.peerId}`} disabled={busy} onPress={() => onRemove(p.peerId)} />
            </>
          ) : <SmallButton label="Remove" testID={`peer-remove-${p.peerId}`} onPress={() => onAskRemove(p.peerId)} />,
        })}
      />,
    );
  }
  const settled: ReactElement[] = [];
  for (const c of conflicts) settled.push(<SettingsRow key={c.conflictId} id={`peer.conflict.${c.conflictId}`} first={settled.length === 0} label={c.detail} sub={`${c.kind === "kept_aside" ? "Kept aside" : "Renamed"} · ${whenLabel(c.at, now)}`} />);
  return (
    <>
      <Section title="Your computers" help={ADD_HELP} testID="peers-list">
        {rows}
        {error ? <Text testID="peers-error" style={{ color: "var(--danger)" as string, fontSize: 13, marginTop: 6 }}>{error}</Text> : null}
      </Section>
      {settled.length ? <Section title="Sync conflicts" help="Things your computers changed at the same time while apart. Nothing is dropped: the later change keeps the name and the other is renamed or kept aside." testID="peer-conflicts">{settled}</Section> : null}
    </>
  );
}

/** The live section: shown in a Personal Space. */
export function PeersSection(): ReactElement | null {
  const data = useSettingsData();
  const [peers, setPeers] = useState<PeerRow[]>([]);
  const [requests, setRequests] = useState<PeerRequestRow[]>([]);
  const [now, setNow] = useState(() => data.clock().now);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<PeerConflictRow[]>([]);
  const [runner, setRunner] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const load = useCallback(async (): Promise<void> => {
    try {
      const [p, r, c, run] = await Promise.all([
        data.call("network.peers", {}) as Promise<{ computers: PeerRow[] }>,
        data.call("network.peer_requests", {}) as Promise<{ requests: PeerRequestRow[] }>,
        (data.call("network.peer_conflicts", {}) as Promise<{ conflicts: PeerConflictRow[] }>).catch(() => ({ conflicts: [] })),
        (data.call("network.peer_runner", {}) as Promise<{ peerId?: string }>).catch(() => ({} as { peerId?: string })),
      ]);
      if (alive.current) { setPeers(p.computers); setRequests(r.requests); setConflicts(c.conflicts); setRunner(run.peerId ?? null); setNow(Date.now()); }
    } catch { /* the list stays as it was */ }
  }, [data]);
  useEffect(() => { void load(); const t = setInterval(() => void load(), POLL_MS); return () => clearInterval(t); }, [load]);
  const guarded = async (run: () => Promise<void>, fail: string): Promise<void> => {
    setBusy(true); setError("");
    try { await run(); await load(); } catch { if (alive.current) setError(fail); } finally { if (alive.current) setBusy(false); }
  };
  if (!peers.length && !requests.length) return null;
  return (
    <PeersBody
      peers={peers} requests={requests} conflicts={conflicts} runner={runner} now={now} busy={busy} removing={removing} error={error}
      onAllow={(id) => void guarded(async () => { await data.call("network.peer_allow", { requestId: id }); }, "Couldn't allow it. Try again.")}
      onDecline={(id) => void guarded(async () => { await data.call("network.peer_decline", { requestId: id }); }, "Couldn't decline it.")}
      onAskRemove={setRemoving}
      onRemove={(id) => void guarded(async () => { await data.call("network.peer_remove", { peerId: id }); setRemoving(null); }, "Couldn't remove it.")}
    />
  );
}
