// The Automations place: the shell sidebar slot holds the list, and the body holds the open Automation or an operational view.
import { openIn, takeOpenHow } from "../tabs/open-how.ts";
import { isPhoneWidth } from "../../../../../ui/src/SidePane/layout.ts";
import { ResizableColumn } from "../../../../../ui/src/SidePane/resize.tsx";
import { useConnectVersion } from "../connect/context.ts";
import { useEffect, useMemo, useState } from "react";
import { useOpenedId, usePlaceHash } from "../hash/context.tsx";
import { NotFound } from "../hash/NotFound.tsx";
import { useMissing } from "../hash/useMissing.ts";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { scrubAskContext } from "../../places/automations/ask/bundle.ts";
import { reach } from "../reach/reach.ts";
import { useViewer } from "../reach/viewer.ts";
import { BUILD_CONNECTOR_OPENING, connectorOpening, readyToBuild } from "../../places/vault/itemenv/automations.ts";
import { openAsk } from "./ask.ts";
import { useAssistantBuilds } from "./builds.ts";
import { AutomationsDataProvider } from "../../places/automations/canvas/data.tsx";
import type { AutomationsData, KeysStatus } from "../../places/automations/canvas/data.tsx";
import type { KeyChoice } from "../../places/automations/canvas/model.ts";
import { TextButton } from "../../places/automations/canvas/parts.tsx";
import { BuilderPage } from "../../places/automations/screens/BuilderPage.tsx";
import { FirstPage } from "../../places/automations/screens/FirstPage.tsx";
import { accountsFromVault, picksByApp } from "../../places/automations/connect/accounts.ts";
import type { AccountOption } from "../../places/automations/connect/accounts.ts";
import { connectionRoute } from "../../places/automations/connect/route.ts";
import { ConfigExtrasProvider } from "../../places/automations/config/data.tsx";
import { RunsDataProvider } from "../../places/automations/runs/data.tsx";
import {
  AutomationRuns,
  FailedView,
  JourneyNewView,
  JourneyView,
  RunView,
  configExtras,
  runsData,
  useDirectory,
} from "./automations-parts.tsx";
import { TemplateGallery, Watching } from "../../places/automations/operations/StudioViews.tsx";
import { openAskPane } from "../ask/pane.ts";
import { AutomationsSidebarSlot } from "../../places/automations/sidebar/AutomationsSidebarSlot.tsx";
import { RunsList } from "../../places/automations/screens/RunsList.tsx";
import { AutomationsList } from "../../places/automations/sidebar/AutomationsList.tsx";
import type { StudioView } from "../../places/automations/sidebar/AutomationsSidebarSlot.tsx";
import { keysFromAccounts } from "../../places/automations/values/typed.ts";
import { nameOf } from "./misc-common.ts";
import { GATE, allows, useOptionalShellRuntime } from "./runtime.tsx";
import type { ShellRuntime } from "./runtime.tsx";

export function automationsData(
  rt: ShellRuntime,
  nav: AutomationsData["nav"],
  keys: readonly KeyChoice[] = [],
  keysStatus?: KeysStatus,
  accounts?: readonly AccountOption[],
  lastPicks?: Readonly<Record<string, string>>,
): AutomationsData {
  return {
    ...(rt.space.kind === "personal" ? { personalSpace: true } : {}),
    screens: rt.screens,
    call: rt.call,
    me: { id: rt.me.id, name: rt.me.name },
    spaceName: rt.space.name,
    name: nameOf(rt),
    keys,
    ...(keysStatus ? { keysStatus } : {}),
    ...(accounts ? { accounts } : {}),
    ...(lastPicks ? { lastPicks } : {}),
    nav,
    clock: () => ({ now: rt.clock().now }),
    canSpace: allows(rt, GATE.spaceAutomations),
  };
}

/** The tab hash names the Watching view. */
export const watchingHash = (screen: string | undefined): boolean => screen === "watching";

type Overlay =
  | { kind: "failed" }
  | { kind: "run"; id: string }
  | { kind: "journey"; id: string }
  | { kind: "journeyNew" };

function Loading(): ReactElement {
  return <View style={s.page} testID="automations-loading" />;
}

function Body({ rt }: { rt: ShellRuntime }): ReactElement {
  const { opened, target } = usePlaceHash();
  const hashed = useOpenedId(["automation"], ["automationId"]);
  const [picked, setOpenId] = useState<string | null>(null);
  // Vyre for Chrome opens /automations#screen=watching (the tab hash, so the same link works on the web, the desktop app and the phone)
  const [view, setViewRaw] = useState<StudioView>(() => (watchingHash(target.screen) ? "watching" : "automations"));
  const [overlay, setOverlayRaw] = useState<Overlay | null>(null);
  // a Journey or a run named by the tab's hash (a task's "From a journey" chip, the Console, a pasted link, a reload) opens the same view a click on its row does; leaving it remembers the id, as `left` does for an Automation
  const hashedJourney = useOpenedId(["journey"], ["journeyId"]);
  const hashedRun = useOpenedId(["run"], ["runId"]);
  const [leftHashed, setLeftHashed] = useState<string | null>(null);
  const hashedOverlay: Overlay | null =
    hashedJourney !== null && hashedJourney !== leftHashed
      ? { kind: "journey", id: hashedJourney }
      : hashedRun !== null && hashedRun !== leftHashed
        ? { kind: "run", id: hashedRun }
        : null;
  const overlayNow = overlay ?? hashedOverlay;
  const setOverlay = (next: Overlay | null | ((o: Overlay | null) => Overlay | null)): void => {
    const value = typeof next === "function" ? next(overlayNow) : next;
    setOverlayRaw(value);
    // closing the view of a hash-named Journey or run keeps it closed while the hash still names it
    if (value === null || value.kind === "failed" || value.kind === "journeyNew")
      setLeftHashed(hashedJourney ?? hashedRun);
  };
  const [step, setStep] = useState<string | null>(null);
  const [sideRun, setSideRun] = useState<string | null>(null);
  // a task a run made, beside the run: its thread, brief and baton buttons (the Back button returns to the run)
  const setView = (next: StudioView): void => {
    setOverlay(null);
    setViewRaw(next);
    if (next === "watching") opened({ screen: "watching" });
    else if (watchingHash(target.screen)) opened({});
  };
  const [keys, setKeys] = useState<readonly KeyChoice[]>([]);
  const [keysStatus, setKeysStatus] = useState<KeysStatus>("loading");
  const [accounts, setAccounts] = useState<readonly AccountOption[]>([]);
  const connectVersion = useConnectVersion();
  const [lastPicks, setLastPicks] = useState<Readonly<Record<string, string>> | undefined>(undefined);
  // the Automations row in the sidebar leaves the open automation (the hash keeps naming it, so that id is remembered as left)
  const [left, setLeft] = useState<string | null>(null);
  const openId = picked ?? (hashed !== null && hashed === left ? null : hashed);
  const goHome = (): void => {
    setOverlay(null);
    setOpenId(null);
    setLeft(hashed);
    setStep(null);
    setSideRun(null);
  };
  const missing = useMissing(
    rt.screens,
    "automations.canvas",
    "automation",
    openId ? { automationId: openId, route: { automationId: openId } } : null,
  );
  useEffect(() => {
    let live = true;
    void rt
      .call("engine.accounts.list", { place: "automation" })
      .then((out) => {
        if (!live) return;
        const parsed = keysFromAccounts(out);
        if (!parsed) {
          setKeys([]);
          setKeysStatus("unavailable");
          return;
        }
        setKeys(parsed);
        setKeysStatus(parsed.length > 0 ? "ready" : "empty");
      })
      .catch(() => {
        if (live) {
          setKeys([]);
          setKeysStatus("unavailable");
        }
      });
    return () => {
      live = false;
    };
  }, [rt, connectVersion]);
  useEffect(() => {
    let live = true;
    void Promise.all([
      rt.call("connections.list", { whose: "all" }),
      rt.call("mail.mailbox.list", { scope: "all" }),
      rt.call("automations.account_picks", {}),
    ])
      .then(([connectionsOut, mailOut, picksOut]) => {
        if (!live) return;
        const nextAccounts = accountsFromVault(connectionsOut, mailOut, rt.me.id);
        const nextPicks = picksByApp(picksOut);
        if (!nextAccounts || !nextPicks) {
          setAccounts([]);
          setLastPicks(undefined);
          return;
        }
        setAccounts(nextAccounts);
        setLastPicks(nextPicks);
      })
      .catch(() => {
        if (!live) return;
        setAccounts([]);
        setLastPicks(undefined);
      });
    return () => {
      live = false;
    };
  }, [rt, connectVersion]);
  const viewer = useViewer(rt);
  const addressReach = viewer === null ? null : reach({ kind: "console", page: "network" }, viewer);
  const addressDoor = addressReach !== null && addressReach.to === "open" ? addressReach.target : null;
  const addressScreen = addressDoor?.screen ?? null;
  const assistantBuilds = useAssistantBuilds(rt);
  const data = useMemo(
    () =>
      automationsData(
        rt,
        {
          leave: () => {
            setOpenId(null);
            setLeft(hashed);
            setStep(null);
            setSideRun(null);
          },
          openAutomation: (id) => {
            // Cmd-press, the middle button or "Open in New Tab": the Automation opens as a tab beside this one (tabs/open-rule.ts)
            const how = takeOpenHow();
            if (how !== "here") {
              openIn(how, () => rt.open({ subject: { type: "automation", id } }));
              return;
            }
            setView("automations");
            setStep(null);
            setOpenId(id);
            opened({ subject: { type: "automation", id } });
          },
          openJourney: (id) => {
            // Cmd-press, the middle button or "Open in New Tab": the Journey opens as a tab beside this one, as an Automation does
            const how = takeOpenHow();
            if (how !== "here") {
              openIn(how, () => rt.open({ subject: { type: "journey", id } }));
              return;
            }
            setViewRaw("automations");
            setLeftHashed(null);
            setOverlay({ kind: "journey", id });
            opened({ subject: { type: "journey", id } });
          },
          newJourney: () => {
            setViewRaw("automations");
            setOverlay({ kind: "journeyNew" });
          },
          openFailedRuns: () => {
            setViewRaw("automations");
            setOverlay({ kind: "failed" });
          },
          openTemplates: () => setView("templates"),
          openRun: (runId) => {
            setViewRaw("automations");
            setOverlay({ kind: "run", id: runId });
          },
          ask: (id, context) => {
            // the Ask pane opens beside the automation, about it, with the scrubbed failure (step, error code, trace) as what the agent is told; the message is put in the composer to send
            const bundle = scrubAskContext({ ...(context ?? {}), resource: context?.resource ?? id });
            // a door that only knows "automation" or a step id (a step's test, a list's error) asks about Automations itself, with what it does know as context
            const isAutomation = /^aut_[A-Za-z0-9_]+$/.test(id);
            const ask = (title?: string): void => {
              openAskPane(
                {
                  thing: isAutomation ? { kind: "automation", id, ...(title ? { title } : {}) } : null,
                  ...(bundle.message
                    ? {
                        draft: bundle.message.trim().endsWith("?")
                          ? bundle.message
                          : `Why does this fail? ${bundle.message}`,
                      }
                    : {}),
                  context: {
                    actions: ["explain a failed run", "propose a fix as a draft", "suggest a template"],
                    ...(bundle.nodeId
                      ? {
                          selection: [
                            { type: "step", id: bundle.nodeId, ...(bundle.stepKey ? { title: bundle.stepKey } : {}) },
                          ],
                        }
                      : !isAutomation && id !== "automation"
                        ? { selection: [{ type: "step", id }] }
                        : {}),
                    ...(bundle.errorCode || bundle.traceId
                      ? {
                          filters: {
                            ...(bundle.errorCode ? { errorCode: bundle.errorCode } : {}),
                            ...(bundle.traceId ? { traceId: bundle.traceId } : {}),
                          },
                        }
                      : {}),
                  },
                },
                "automations",
              );
            };
            if (!isAutomation) {
              ask();
              return;
            }
            void Promise.resolve(rt.call("automations.get", { automationId: id })).then(
              (o) => ask((o as { automation?: { name?: string } } | null)?.automation?.name),
              () => ask(),
            );
          },
          connect: (target) => {
            const route = connectionRoute(target, rt.space.kind === "personal");
            rt.open({ screen: route.screen, args: route.args });
          },
          openKeys: () => rt.open({ screen: "vault.providers" }),
          // only when the assistant can build connectors (or its person can allow it): the press allows it first
          ...(assistantBuilds.builds
            ? {
                buildConnector: () => {
                  assistantBuilds.press("automations", () =>
                    openAskPane({ thing: null, first: BUILD_CONNECTOR_OPENING }, "automations"),
                  );
                },
                ...(assistantBuilds.note ? { buildConnectorNote: assistantBuilds.note } : {}),
              }
            : {}),
          // the public address is set in Console; only a person who can open that page gets the door (reach)
          ...(addressScreen
            ? { openAddress: () => rt.open({ screen: addressScreen, args: addressDoor?.args ?? {} }) }
            : {}),
          setUpConnector: async (offer) => {
            // the offer holds an item id and a name; the handle comes from the Vault, which never sends a value
            const got = (await rt.call("vault.item.get", { itemId: offer.itemId })) as {
              item?: { handle?: string; name?: string };
            } | null;
            const handle = got?.item?.handle;
            if (!handle) throw new Error("Vyre could not find that Vault item. It may have moved to Trash.");
            // the offer was shown because the assistant could finish it; this checks again and, for a person who may give it, gives the assistant the builder role with this press
            await readyToBuild(
              (cap, input) => Promise.resolve(rt.call(cap as never, input as never)),
              rt.assistant.id,
              offer.itemId,
            );
            openAsk(
              rt,
              "assistant",
              { kind: "vault_item", id: offer.itemId, title: offer.appName },
              undefined,
              connectorOpening({ name: got?.item?.name ?? offer.appName, handle }),
            );
          },
        },
        keys,
        keysStatus,
        accounts,
        lastPicks,
      ),
    [rt, opened, keys, keysStatus, accounts, lastPicks, addressScreen, assistantBuilds],
  );
  const directory = useDirectory(rt);
  const extras = useMemo(
    () =>
      configExtras(directory, {
        openAutomation: (id) => data.nav.openAutomation(id),
        openRuns: (id) => {
          data.nav.openAutomation(id);
          setSideRun(null);
        },
        // a Journey's records open in Records on their board
        openRecords: (type) => rt.open({ screen: "records.saved-views", args: { type, kind: "board" } }),
      }),
    [directory, data, rt],
  );
  const runs = useMemo(
    () =>
      runsData(rt, {
        openAutomation: (id, stepId) => {
          data.nav.openAutomation(id);
          if (stepId) setStep(stepId);
        },
        openRun: (runId) => data.nav.openRun(runId),
        openRunSide: (runId) => {
          setSideRun(runId);
        },
        openTaskSide: (taskId) => rt.open({ screen: "tasks.page", args: { taskId } }),
        ask: (id, context) => data.nav.ask(id, context),
      }),
    [rt, data],
  );
  const winW = useWindowDimensions().width;
  const phone = isPhoneWidth(winW); // the phone has no sidebar beside the body: the list is the first screen
  const canvas = openId ? (
    phone && sideRun ? (
      // on the phone a run takes the whole screen; Close goes back to the editor
      <View style={s.main}>
        <View style={s.sideHead}>
          <TextButton label="Back" icon="x" testID="close-side-run" onPress={() => setSideRun(null)} />
        </View>
        <RunView runId={sideRun} />
      </View>
    ) : (
      <View style={s.withSide}>
        <View style={s.main}>
          <BuilderPage
            key={`${openId}:${step ?? ""}`}
            automationId={openId}
            runsBody={<AutomationRuns automationId={openId} selectedRunId={sideRun} />}
            {...(step ? { initialSelected: step } : {})}
          />
        </View>
        {sideRun ? (
          <ResizableColumn
            paneKey="automation-run-side"
            defaultWidth={380}
            grow="left"
            min={280}
            style={s.side as never}
          >
            <View style={s.sideHead}>
              <TextButton label="Close" icon="x" testID="close-side-run" onPress={() => setSideRun(null)} />
            </View>
            <RunView runId={sideRun} />
          </ResizableColumn>
        ) : null}
      </View>
    )
  ) : null;
  const main =
    overlayNow?.kind === "failed" ? (
      <FailedView selectedRunId={sideRun} />
    ) : overlayNow?.kind === "run" ? (
      <RunView runId={overlayNow.id} />
    ) : overlayNow?.kind === "journey" ? (
      <JourneyView journeyId={overlayNow.id} />
    ) : overlayNow?.kind === "journeyNew" ? (
      <JourneyNewView onClose={() => setOverlay((o) => (o?.kind === "journeyNew" ? null : o))} />
    ) : view === "runs" ? (
      <RunsList />
    ) : view === "watching" ? (
      <Watching />
    ) : view === "templates" ? (
      <TemplateGallery />
    ) : openId && missing ? (
      <NotFound what="automation" />
    ) : canvas ? (
      canvas
    ) : phone ? (
      <PhoneList view={view} onView={(next) => (next === "automations" ? setViewRaw(next) : setView(next))} />
    ) : (
      <FirstPage
        onExamples={() => setView("templates")}
        onAllRuns={() => setView("runs")}
        onAsk={() => openAskPane({ thing: null, hint: ASK_HINT, context: ASK_AUTOMATIONS }, "automations")}
      />
    );
  return (
    <AutomationsDataProvider value={data}>
      <RunsDataProvider value={runs}>
        <ConfigExtrasProvider value={extras}>
          <View style={s.page} testID="automations-place">
            {phone ? null : (
              <AutomationsSidebarSlot
                selectedId={openId}
                // choosing a row must not close the view the row just opened (a Journey is a view over the body); only the head's Home and the other views close it
                onView={(next) => (next === "automations" ? setViewRaw(next) : setView(next))}
                onHome={goHome}
              />
            )}
            <View style={s.main}>
              {phone && view !== "automations" && !openId ? (
                <Pressable
                  accessibilityRole="button"
                  testID="phone-back-to-list"
                  onPress={() => setView("automations")}
                  style={s.backChip}
                >
                  <Text style={s.backText}>{"‹ Automations"}</Text>
                </Pressable>
              ) : null}
              {main}
            </View>
          </View>
        </ConfigExtrasProvider>
      </RunsDataProvider>
    </AutomationsDataProvider>
  );
}

export default function AutomationsPlace(_props: { place: string }): ReactElement {
  const rt = useOptionalShellRuntime();
  return rt ? <Body rt={rt} /> : <Loading />;
}

/** The phone's first Automations screen: search, the list (Failed runs, Personal, Shared with me, Space), and the studio views (Templates, All runs ...) under it. A row opens that Automation. */
function PhoneList({ view, onView }: { view: StudioView; onView(next: StudioView): void }): ReactElement {
  const [q, setQ] = useState("");
  return (
    <View style={s.phoneList} testID="automations-phone-list">
      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder="Search automations"
        placeholderTextColor="var(--ink-3)"
        accessibilityLabel="Search automations"
        style={s.phoneSearch}
        testID="automations-phone-search"
      />
      <AutomationsList query={q} selectedId={null} onChoose={() => onView("automations")} />
    </View>
  );
}

/** What the Automations Ask pane tells the assistant about the place: the focus skill for it and what it may propose. Ids and names only. */
const ASK_AUTOMATIONS = {
  title: "Automations",
  actions: ["propose an automation", "suggest a template", "explain a failed run"],
  focus: "focus-automations",
};
const ASK_HINT = "Say what you want to automate. I will draft it and you decide what to keep.";

const s = StyleSheet.create({
  phoneList: { flex: 1, minHeight: 0 },
  phoneSearch: {
    height: 36,
    marginHorizontal: 12,
    marginTop: 10,
    paddingHorizontal: 12,
    borderRadius: 9,
    backgroundColor: "var(--sunk)" as string,
    color: "var(--ink)" as string,
    fontSize: 14,
  },
  backChip: { height: 36, justifyContent: "center", paddingHorizontal: 14 },
  backText: { fontSize: 14, color: "var(--accent)" as string },
  page: { flex: 1, flexDirection: "row", backgroundColor: "var(--win)" as string },
  main: { flex: 1, minWidth: 0 },
  withSide: { flex: 1, flexDirection: "row", minWidth: 0 },
  sideHead: { alignItems: "flex-end", padding: 6 },
  side: { width: 380, borderLeftWidth: 1, borderLeftColor: "var(--line)" as string },
});
