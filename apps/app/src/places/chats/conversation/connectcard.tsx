// The connect card of a chat (finding F38): an agent was asked "do you have Fathom connected?" or to connect a service, and the person gets this one card. Everything it shows is read from the server
// (vault.connect_card.get): its state, the fields the service needs, who can fill it, where the key is kept. A typed key lives in this component's state and in the one call that submits it
// (vault.connect_card.submit); it is never in a message, a block, an event or a log. While that call is out the fields lock and, after 300 ms, a line of steps shows; the answer decides what the card is next.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Text } from "react-native";
import { CardDone } from "../../../../../../ui/src/Card/index.tsx";
import { Glyph } from "./parts.tsx";
import { ConnectCard, ConnectKeyGlyph } from "../../../../../../ui/src/ConnectCard/index.tsx";
import type { ConnectState, ConnectWork } from "../../../../../../ui/src/ConnectCard/index.tsx";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { useWhenText } from "../../../../../../ui/src/Time/index.tsx";
import { rawIdsIn } from "../../../../../../lib/id-shapes.ts";
import type { ConversationData } from "./data.tsx";
import { useFollow } from "./use-follow.ts";
import { cardOf, keptWords, stepsFor } from "./connectcard-model.ts";
import type { ConnectCardData, KeptInFolder } from "./connectcard-model.ts";

type Data = Pick<ConversationData, "call" | "changes"> & { nameOf?: (id: string) => string };

/** Nothing shows for the first 300 ms of a try; then the steps do. A try that fails or finishes sooner never shows them. */
export const WORK_DELAY_MS = 300;
/** After a good answer each step ticks in turn, so the three words read as three things done. */
export const TICK_MS = 140;

/** Did the server refuse because connecting a service this way is off? (internal.not_implemented, its one plain message) */
export const isOff = (e: unknown): boolean => {
  const x = e as { code?: unknown; message?: unknown } | null;
  return x?.code === "internal.not_implemented" || x?.message === "Connecting a service this way is not available yet.";
};

export function ConnectCardLive({
  requestId,
  agent,
  data,
  onOff,
  asker,
}: {
  requestId: string;
  /** The person the agent asked for, and the service: what everyone else in the chat reads (one quiet line, never the card). */
  asker?: string | undefined;
  service?: string | undefined;
  /** The agent's name, for "Dex will use it for you." */
  agent: string;
  data: Data;
  /** The server says connecting this way is off (VYRE_CONNECT_CARD, lib/connect-switch.ts): the caller draws the plain key request card instead. */
  onOff?: () => void;
}): ReactElement | null {
  const [card, setCard] = useState<ConnectCardData | null | undefined>(undefined);
  const [values, setValues] = useState<Record<string, string>>({});
  const [work, setWork] = useState<ConnectWork | null>(null);
  const [open, setOpen] = useState(false);
  const [kept, setKept] = useState<KeptInFolder | null>(null);
  const [focusField, setFocusField] = useState<string | undefined>(undefined);
  const [problem, setProblem] = useState("");
  // what the person has done to the card since the server last spoke: typed after a refusal (the red goes), or chose to use a different key
  const [edited, setEdited] = useState(false);
  const [other, setOther] = useState(false);
  // the option the person picked for the service's choice (a region); the first until they pick
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const { element, show } = useMenu();
  const whenText = useWhenText(true);
  const live = useRef(true);
  const busy = useRef(false);
  useEffect(
    () => () => {
      live.current = false;
    },
    [],
  );

  // a person is named by name, never by id: an id the Space cannot name reads as "an admin" and no name
  const named = (id: string): string => {
    const n = data.nameOf?.(id) ?? "";
    return n && rawIdsIn(n).length === 0 && !/^[a-z]{2,4}_[0-9a-z]+$/i.test(n) ? n : "";
  };

  const load = useCallback(async (): Promise<void> => {
    try {
      const got = cardOf(await data.call("vault.connect_card.get", { requestId }));
      if (live.current) setCard(got);
    } catch (e) {
      if (isOff(e)) onOff?.();
      if (live.current) setCard((cur) => (cur === undefined ? null : cur));
    }
  }, [data, requestId, onOff]);
  useEffect(() => {
    void load();
  }, [load]);
  // an admin connecting it, a second ask, another place pressing Not now: the card follows the request
  useFollow(data.changes, load, card !== null && card?.state !== "gone");

  if (card === undefined || card?.state === "gone") return null;
  // someone else in the chat: the card is the asked person's own, so all they read is one quiet line about how the ask stands
  if (card === null) return <OthersLine requestId={requestId} agent={agent} asker={asker} data={data} named={named} />;
  const name = card.service.title;
  // where the key goes now: the picked option's hosts when the service has a choice, else the card's own
  const option = card.choice
    ? (card.choice.options.find((o) => o.value === picked) ?? card.choice.options[0])
    : undefined;
  const hostsNow = option ? option.hosts : card.checksWith ? card.checksWith.split(", ") : [];

  const put = (field: string, value: string): void => {
    setValues((v) => ({ ...v, [field]: value }));
    setEdited(true);
  };

  /** The call that tries, keeps and connects. The steps show only after 300 ms, tick when the server says yes, and stop where it says no. */
  const submit = async (useSaved: boolean): Promise<void> => {
    // one submit at a time: Enter in the field and a press on Connect a moment later are one ask, not two
    if (busy.current) return;
    busy.current = true;
    try {
      await submitOnce(useSaved);
    } finally {
      busy.current = false;
    }
  };
  const submitOnce = async (useSaved: boolean): Promise<void> => {
    setProblem("");
    setEdited(false);
    const steps = stepsFor(useSaved, card.checks !== false);
    setWork({ steps, step: 0, visible: false });
    const wait = setTimeout(() => setWork((w) => (w ? { ...w, visible: true } : w)), WORK_DELAY_MS);
    try {
      const out = (await data.call("vault.connect_card.submit", {
        requestId,
        // the addresses this card said the key goes to: the server refuses when they are no longer the service's
        hosts: hostsNow,
        // the service revision this card showed: the server refuses when it was published again since
        revision: option ? option.revision : card.service.revision,
        ...(option ? { choice: option.value } : {}),
        ...(useSaved
          ? { useSaved: true }
          : {
              fields: card.fields
                .filter((f) => (values[f.name] ?? "").trim() !== "")
                .map((f) => ({ key: f.name, value: (values[f.name] ?? "").trim() })),
              ...(kept ? { folderId: kept.id } : {}),
            }),
      })) as { result?: string; card?: unknown };
      clearTimeout(wait);
      const next = cardOf(out);
      if (out.result === "connected") {
        // emptied and closed the moment the server says yes, not after the ticks: the done row can already be on screen (the card follows the Space's changes), and
        // closing it after the ticks undid a press a person had just made on it (the phone walk, 16 Nov 2026: the row shut under the walk's finger)
        setValues({});
        setOpen(false);
        for (let i = 1; i <= steps.length; i++) {
          setWork({ steps, step: i, visible: true });
          await new Promise((r) => setTimeout(r, TICK_MS));
        }
      } else setFocusField(card.fields[0]?.name);
      if (live.current) {
        setWork(null);
        if (next) setCard(next);
      }
    } catch (e) {
      clearTimeout(wait);
      if (live.current) {
        setWork(null);
        setProblem((e as { message?: string }).message ?? "That did not work. Try again.");
        void load();
      }
    }
  };

  const act = async (cap: string, input: Record<string, unknown> = {}): Promise<void> => {
    setProblem("");
    try {
      const out = await data.call(cap, { requestId, ...input });
      const next = cardOf(out);
      if (live.current && next) setCard(next);
      else void load();
    } catch (e) {
      if (live.current) setProblem((e as { message?: string }).message ?? "That did not work. Try again.");
      void load();
    }
  };

  const openKept = async (at: { x: number; y: number }): Promise<void> => {
    let folders: KeptInFolder[] = [];
    let fallback: string | undefined;
    try {
      const out = (await data.call("vault.connect_card.options", { requestId })) as {
        folders?: KeptInFolder[];
        default?: string;
      };
      folders = out.folders ?? [];
      fallback = out.default;
    } catch {
      folders = [];
    }
    const items: MenuEntry[] = [];
    const mine = folders.filter((f) => f.scope === "mine");
    const shared = folders.filter((f) => f.scope === "shared" && f.usable);
    const barred = folders.filter((f) => !f.usable);
    const pick = (f: KeptInFolder) => () => setKept(f);
    for (const f of mine)
      items.push({
        label: "Mine",
        checked: (kept?.id ?? fallback) === f.id,
        hint: "You and agents working for you",
        onSelect: pick(f),
      });
    for (const f of shared)
      items.push({
        label: f.name,
        checked: (kept?.id ?? fallback) === f.id,
        hint: "The team and its agents",
        onSelect: pick(f),
      });
    if (barred.length > 0) {
      items.push({ head: "Restricted" });
      for (const f of barred)
        items.push({
          label: f.name,
          disabled: true,
          reason: "Agents can't use keys kept here",
          hint: "Agents can't use keys kept here",
        });
    }
    show(items, at.x, at.y, "other", { label: "Kept in" });
  };

  const adminName = card.admin ? named(card.admin.id) : "";
  const state: ConnectState =
    (card.state === "wrong" && edited) || (card.state === "have" && other) ? "ask" : card.state;
  return (
    <>
      <ConnectCard
        id={`connect-${requestId}`}
        state={state}
        service={name}
        site={card.service.site}
        agent={agent}
        fields={card.fields}
        values={values}
        onChange={put}
        work={work}
        keptIn={keptWords(kept, card)}
        onKeptIn={card.mayFill ? (at) => void openKept(at) : undefined}
        have={card.have ? { name: card.have.name, where: `${card.have.keptIn}` } : undefined}
        admin={adminName || undefined}
        askedAt={card.admin?.askedAt ? whenText(card.admin.askedAt, Date.now()) : undefined}
        tested={card.tested}
        checksWith={hostsNow.length > 0 ? hostsNow.join(", ") : undefined}
        choice={
          card.choice && option
            ? {
                label: card.choice.label,
                value: option.value,
                options: card.choice.options.map((o) => ({ value: o.value, label: o.label })),
              }
            : undefined
        }
        onChoice={(v) => setPicked(v)}
        problem={card.problem}
        notice={card.notice}
        usedBy={card.usedBy.length > 0 ? card.usedBy.map(() => agent).join(", ") : undefined}
        connectedBy={card.connectedBy ? named(card.connectedBy) || undefined : undefined}
        open={open}
        onToggle={() => setOpen(!open)}
        focusField={focusField}
        on={{
          connect: () => void submit(state === "have"),
          retry: () => void submit(false),
          notNow: () => void act("vault.requests.decline"),
          askAdmin: () => void act("vault.connect_card.ask_admin", card.admin ? { admin: card.admin.id } : {}),
          reopen: () => void act("vault.connect_card.reopen"),
          disconnect: () => void act("vault.connect_card.disconnect"),
          useDifferent: () => setOther(true),
        }}
      />
      {problem ? <ProblemLine text={problem} /> : null}
      {element}
    </>
  );
}

function ProblemLine({ text }: { text: string }): ReactElement {
  // a refusal the card has no state for (a stale card, a closed one): one quiet line under it
  return (
    <Text accessibilityRole="alert" style={{ fontSize: 12.5, color: "var(--danger)" as string, marginTop: 4 }}>
      {text}
    </Text>
  );
}

type Line = { state: "asked" | "connected" | "declined"; service: string; asker?: string; connectedBy?: string };
/** What everyone but the asked person reads: asked (a key glyph), connected (a tick), declined (nothing: the quietest). */
function OthersLine({
  requestId,
  agent,
  asker,
  data,
  named,
}: {
  requestId: string;
  agent: string;
  asker?: string | undefined;
  data: Data;
  named: (id: string) => string;
}): ReactElement | null {
  const [line, setLine] = useState<Line | null>(null);
  const load = useCallback(async (): Promise<void> => {
    try {
      setLine((await data.call("vault.connect_card.line", { requestId })) as Line);
    } catch {
      /* the line stays as it was */
    }
  }, [data, requestId]);
  useEffect(() => {
    void load();
  }, [load]);
  useFollow(data.changes, load, line?.state !== "declined");
  if (!line || line.state === "declined") return null;
  const who = (id?: string): string => (id ? named(id) : "") || "someone";
  return (
    <CardDone
      testID={`connect-asked-${requestId}`}
      ok={line.state === "connected"}
      glyph={line.state === "connected" ? <Glyph name="check" size={13} color="var(--ink-3)" /> : <ConnectKeyGlyph />}
      text={
        line.state === "connected"
          ? `${who(line.connectedBy ?? line.asker)} connected ${line.service}`
          : `${agent} asked ${who(asker ?? line.asker)} to connect ${line.service}`
      }
    />
  );
}
