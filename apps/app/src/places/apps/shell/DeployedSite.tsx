// A site Vyre builds and runs, as one page with six tabs under a header that says its state, its address and Deploy: Overview (what is live, what needs a person, what it runs with), Deploys
// (every deploy, one row each; a row opens that deploy with its four steps and its log beside the list), Logs, Variables (env vars from the Vault), Domains, and Settings (source, database,
// who may open it, CPU and memory, stop). A failure says why in a sentence with its one button. Plain text that updates in place: nothing blinks.
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { ResizableColumn } from "../../../../../../ui/src/SidePane/resize.tsx";
import { Status, TONE_COLOR } from "../../../../../../ui/src/Status/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { useAppsData } from "./data.tsx";
import type { AppsData } from "./data.tsx";
import { actionKey, errorMessage, mutate } from "./mutations.ts";
import { Button, Card, Frame, Select, s as ui, useOnline, useRead } from "./editor-ui.tsx";
import { ago } from "./model.ts";
import { copy, DomainRow } from "./SiteDetail.tsx";
import { uploadPicked } from "./NewSiteSheet.tsx";
import { DeployDetail } from "./site/DeployPane.tsx";
import {
  FIX_TITLE,
  attention,
  depNote,
  depState,
  depTitle,
  findLines,
  isRunning,
  missingName,
  siteWord,
  sourceLine,
} from "./site/model.ts";
import { LogLines, StepMark, markOf } from "./site/parts.tsx";
import { Variables } from "./site/Variables.tsx";
import { Webhook } from "./site/Webhook.tsx";
import type { EnvEntry } from "./site/model.ts";

type Site = CapMap["sites.get"]["out"]["site"];
type Dep = CapMap["sites.deployments"]["out"]["deployments"][number];
const ACCESS = [
  { key: "space", title: "People in this Space" },
  { key: "private", title: "Only you and people you share with" },
  { key: "password", title: "Anyone with the password" },
  { key: "public", title: "Anyone with the address" },
] as const;
const CPUS = [
  { key: "0.5", title: "Half a CPU" },
  { key: "1", title: "1 CPU" },
  { key: "2", title: "2 CPUs" },
] as const;
const MEMORY = [
  { key: "256", title: "256 MB" },
  { key: "512", title: "512 MB" },
  { key: "1024", title: "1 GB" },
  { key: "2048", title: "2 GB" },
] as const;

type TabKey = "overview" | "deploys" | "logs" | "variables" | "domains" | "settings";
const TABS: readonly { key: TabKey; title: string }[] = [
  { key: "overview", title: "Overview" },
  { key: "deploys", title: "Deploys" },
  { key: "logs", title: "Logs" },
  { key: "variables", title: "Variables" },
  { key: "domains", title: "Domains" },
  { key: "settings", title: "Settings" },
];
const WIDE = 900;

export function DeployedSite({ site: x, refresh, back }: { site: Site; refresh(): void; back(): void }): ReactElement {
  const d = useAppsData(),
    online = useOnline();
  const wide = useWindowDimensions().width >= WIDE;
  const id = x.siteId;
  const deps = useRead<CapMap["sites.deployments"]["out"]>("sites.deployments", { siteId: id, limit: 20 }, "sites");
  const previews = useRead<CapMap["sites.previews"]["out"]>("sites.previews", { siteId: id }, "sites");
  const env = useRead<CapMap["sites.env_list"]["out"]>("sites.env_list", { siteId: id }, "sites");
  const host = useRead<CapMap["sites.host"]["out"]>("sites.host", {}, "sites");
  const domains = useRead<CapMap["sites.domains_get"]["out"]>("sites.domains_get", { siteId: id }, "sites");
  const [runLog, setRunLog] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null),
    [note, setNote] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("overview");
  // the deploy opened beside the list (or over it on a phone), and a Deploy just pressed whose row is about to appear
  const [openId, setOpenId] = useState<string | null>(null);
  const [follow, setFollow] = useState(false);
  // after a rollback the build it replaced can be put back with one press
  const [undo, setUndo] = useState<{ id: string; title: string } | null>(null);
  const [find, setFind] = useState("");
  const [envName, setEnvName] = useState(""),
    [password, setPassword] = useState(""),
    [domain, setDomain] = useState(""),
    [importKey, setImportKey] = useState("");
  const [keys, setKeys] = useState<readonly { handle: string; name: string }[]>([]);
  const building = x.state === "building";
  const last = x.lastDeploy;
  const now = d.clock().now;
  const wasBuilding = useRef(building);
  // a deploy that ends refreshes the page once: the address, the list and the env reads follow it
  useEffect(() => {
    if (wasBuilding.current && !building) {
      deps.refresh();
      env.refresh();
    }
    wasBuilding.current = building;
  }, [building]); // eslint-disable-line react-hooks/exhaustive-deps
  // while one runs the site, its list and its steps are read again every second or two
  useEffect(() => {
    if (!building) return undefined;
    const t = setInterval(() => {
      refresh();
      deps.refresh();
    }, 1500);
    return () => clearInterval(t);
  }, [building, refresh]); // eslint-disable-line react-hooks/exhaustive-deps
  // a preview that is building is read again every two seconds, with its steps
  const previewBusy = (previews.data?.previews ?? []).some(isRunning);
  useEffect(() => {
    if (!previewBusy) return undefined;
    const t = setInterval(() => previews.refresh(), 2000);
    return () => clearInterval(t);
  }, [previewBusy]); // eslint-disable-line react-hooks/exhaustive-deps
  // a deploy that starts (from here, from an agent, or on a push) opens once, so the page shows it moving
  const autoOpened = useRef(false);
  useEffect(() => {
    if (building && !autoOpened.current && last) {
      autoOpened.current = true;
      setTab("deploys");
      setOpenId(last.deploymentId);
    }
    if (!building) autoOpened.current = false;
  }, [building, last]);
  // Deploy was pressed: its deploy opens as soon as it is in the list
  useEffect(() => {
    if (follow && last && isRunning(last)) {
      setOpenId(last.deploymentId);
      setTab("deploys");
      setFollow(false);
    }
  }, [follow, last]);
  useEffect(() => {
    if (tab !== "logs" && tab !== "overview") return undefined;
    let live = true;
    const read = (): void => {
      void (d.call("sites.logs", { siteId: id, tail: 400 }) as Promise<{ lines: string[] }>).then(
        (o) => {
          if (live) setRunLog(o.lines);
        },
        () => undefined,
      );
    };
    read();
    const t = setInterval(read, 4000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [d, id, tab]);
  useEffect(() => {
    if (tab !== "variables" && tab !== "settings") return undefined;
    let live = true;
    void (d.call("vault.items.list", { limit: 200 }) as Promise<CapMap["vault.items.list"]["out"]>).then(
      (o) => {
        if (live) setKeys(o.items.map((i) => ({ handle: i.handle, name: i.name })));
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [d, tab]);

  const run = async (
    label: string,
    cap: string,
    input: Record<string, unknown>,
    after?: () => void,
  ): Promise<unknown> => {
    setBusy(label);
    setError(null);
    setNote(null);
    if (cap !== "sites.rollback") setUndo(null);
    try {
      const out = await mutate(d, cap, input, actionKey());
      if ((out as { status?: string })?.status === "held") {
        d.nav.openTask((out as { taskId: string }).taskId);
        return out;
      }
      refresh();
      deps.refresh();
      env.refresh();
      domains.refresh();
      after?.();
      return out;
    } catch (e) {
      setError(errorMessage(e));
      return null;
    } finally {
      setBusy(null);
    }
  };
  const deploy = (): Promise<unknown> => {
    setFollow(true);
    return run("Deploying", "sites.deploy", { siteId: id }).then((o) => {
      if (!o) setFollow(false);
      return o;
    });
  };
  const cancel = (): void => void run("Canceling", "sites.deploy_cancel", { siteId: id });
  const buildBranch = (name: string): Promise<unknown> =>
    run("Building the preview", "sites.preview_rebuild", { siteId: id, branch: name }, () => {
      previews.refresh();
    });
  const promote = (dep: Dep): void =>
    void run("Promoting", "sites.preview_promote", { siteId: id, branch: dep.branch ?? "" }, () => {
      setOpenId(null);
      setFollow(true);
    });
  const removePreview = (dep: Dep): void =>
    void run("Removing", "sites.preview_remove", { siteId: id, branch: dep.branch ?? "" }, () => {
      previews.refresh();
      setOpenId(null);
    });
  const rollback = (dep: Dep): void => {
    const was = list.find((r) => r.current);
    void run("Rolling back", "sites.rollback", { siteId: id, toDeploymentId: dep.deploymentId }).then((o) => {
      if (o && was) setUndo({ id: was.deploymentId, title: depTitle(was) });
    });
  };
  const undoRollback = (): void => {
    const back = undo;
    if (!back) return;
    setUndo(null);
    void run("Rolling back", "sites.rollback", { siteId: id, toDeploymentId: back.id });
  };
  const askAgent = (): void => {
    const first = `My site "${x.name}" does not deploy. Vyre says: ${last?.problem ?? "it failed"}. Look at its build log (sites_logs with build) and fix the project, then deploy it again with sites_deploy.`;
    if (d.nav.ask) d.nav.ask(first);
    else d.nav.newSite?.();
  };
  const fix = (kind: string): void => {
    if (kind === "retry") void deploy();
    else if (kind === "add_postgres" || kind === "add_redis")
      void run(kind === "add_postgres" ? "Adding Postgres" : "Adding Redis", "sites.addon_add", {
        siteId: id,
        kind: kind === "add_postgres" ? "postgres" : "redis",
      }).then((o) => {
        if (o) void deploy();
      });
    else if (kind === "more_memory")
      void run("Saving", "sites.update", {
        siteId: id,
        limits: {
          ...(x.limits ?? { cpus: 1, memoryMb: 512 }),
          memoryMb: Math.min(8192, (x.limits?.memoryMb ?? 512) * 2),
        },
      }).then((o) => {
        if (o) void deploy();
      });
    else if (kind === "open_logs") {
      setTab("deploys");
      if (last) setOpenId(last.deploymentId);
    } else if (kind === "free_space") setTab("settings");
    else if (kind === "set_env") {
      const m = missingName(last?.problem);
      if (m) setEnvName(m);
      setTab("variables");
      setNote("Pick the Vault key for it below, then deploy again.");
    } else if (kind === "connect_repo") {
      setTab("settings");
      setNote(
        "Change the source: make a new site with the right repo or upload, or give the token for a private repo.",
      );
    } else askAgent();
  };

  const word = siteWord(x);
  const need = attention(x, now);
  const domainRows: ReactElement[] = [];
  for (const row of domains.data?.domains ?? [])
    domainRows.push(<DomainRow key={row.domain} siteId={id} domain={row.domain} online={online} />);
  const envRows = env.data?.entries ?? [];
  const wanted = env.data?.wanted ?? [];
  const addon = (
    kind: "postgres" | "redis",
  ): { kind: string; state: string; envName: string; detail?: string } | undefined =>
    x.addons?.find((a) => a.kind === kind);
  const pg = addon("postgres"),
    redis = addon("redis");
  const list = deps.data?.deployments ?? [];
  const previewList = previews.data?.previews ?? [];
  const opened = openId ? [...list, ...previewList].find((r) => r.deploymentId === openId) : undefined;
  const [branch, setBranch] = useState("");
  const who = (by: string | undefined): string | null =>
    by ? (by === d.me?.id ? "you" : (d.nameOf?.(by) ?? "a teammate")) : null;
  // ui-rows-lint: not a list (chips to pick one Vault key)
  const keyChips = (on: string, set: (h: string) => void): ReactElement => (
    <View style={s.chips}>
      {keys.length === 0 ? (
        <Text style={ui.text}>No Vault keys yet. Add one in the Vault first.</Text>
      ) : (
        keys.slice(0, 16).map((k) => (
          <Pressable
            key={k.handle}
            accessibilityRole="radio"
            accessibilityState={{ checked: on === k.handle }}
            onPress={() => set(k.handle)}
            style={[s.chip, on === k.handle && s.chipOn]}
          >
            <Text style={s.chipText} numberOfLines={1}>
              {k.name}
            </Text>
          </Pressable>
        ))
      )}
    </View>
  );
  const off = !!busy || !online;
  const detail = opened ? (
    <DeployDetail
      site={x}
      dep={opened}
      busy={!!busy}
      online={online}
      onCancel={cancel}
      onRollback={rollback}
      onRedeploy={() => void deploy()}
      onFix={fix}
      onPromote={promote}
      onRemove={removePreview}
      onRebuild={(dep) => void buildBranch(dep.branch ?? "")}
      inPage={!wide}
    />
  ) : null;

  const overview = (
    <>
      {need ? (
        <Status
          tone={need.tone}
          label={need.label}
          note={need.note}
          testID="site-problem"
          action={
            need.kind === "running"
              ? {
                  label: "Watch",
                  onPress: () => {
                    setTab("deploys");
                    if (last) setOpenId(last.deploymentId);
                  },
                }
              : last?.fix && last.fix !== "open_logs"
                ? {
                    label: FIX_TITLE[last.fix] ?? "Deploy again",
                    onPress: () => fix(last.fix as string),
                    disabled: off,
                  }
                : { label: "Read the log", onPress: () => fix("open_logs") }
          }
        />
      ) : null}
      <Card title="Live now">
        {last && (last.current || x.live) ? (
          <Text style={ui.text} testID="site-last">
            {depTitle(deps.data?.deployments.find((r) => r.current) ?? last)}
          </Text>
        ) : (
          <Text style={ui.text}>Nothing is live yet.</Text>
        )}
        {last ? (
          <Text style={ui.text}>{depNote(last, who(last.by), ago(last.finishedAt ?? last.at, now), now)}</Text>
        ) : null}
        {x.source ? <Text style={ui.text}>{`From ${sourceLine(x.source)}`}</Text> : null}
      </Card>
      <Card title="Runs with">
        <Row id="run-web" title="Web" note={x.live ? "Serving its address" : "Not serving"} />
        {pg ? (
          <Row
            id="run-pg"
            title="Postgres"
            note={`${pg.state === "ready" ? "Running" : pg.state === "failed" ? "Failed" : "Starting"} · DATABASE_URL`}
          />
        ) : null}
        {redis ? (
          <Row id="run-redis" title="Redis" note={`${redis.state === "ready" ? "Running" : "Starting"} · REDIS_URL`} />
        ) : null}
      </Card>
      <Card title="App log">
        <LogLines lines={runLog.slice(-60)} testID="site-logs-peek" empty="Nothing logged yet." height={160} />
      </Card>
    </>
  );

  const deploysTab = (
    <>
      {!wide && opened ? (
        <View style={s.paneBack}>
          <Button title="Back to deploys" onPress={() => setOpenId(null)} />
          {detail}
        </View>
      ) : (
        <View>
          <Card title="Deploys">
            {list.length === 0 ? (
              <Text style={ui.text}>None yet.</Text>
            ) : (
              list.map((dep: Dep) => {
                const ds = depState(dep);
                return (
                  <Row
                    key={dep.deploymentId}
                    id={dep.deploymentId}
                    title={depTitle(dep)}
                    note={depNote(dep, who(dep.by), ago(dep.finishedAt ?? dep.at, now), now)}
                    selected={dep.deploymentId === openId}
                    leading={<StepMark state={markOf(dep.state)} />}
                    onPress={() => setOpenId(dep.deploymentId)}
                    trailing={
                      <Text style={s.rowWord} testID={`site-dep-${dep.deploymentId}`}>
                        {ds.word}
                      </Text>
                    }
                  />
                );
              })
            )}
          </Card>
          {x.source?.repo ? (
            <Card title="Previews">
              <Text style={ui.text}>
                A branch built at its own address, behind sign-in. A new build replaces the one before it.
              </Text>
              {previewList.length === 0 ? <Text style={ui.text}>None yet.</Text> : null}
              {previewList.map((dep: Dep) => (
                <Row
                  key={dep.deploymentId}
                  id={`preview-${dep.deploymentId}`}
                  title={dep.branch ?? "branch"}
                  note={depNote(dep, who(dep.by), ago(dep.finishedAt ?? dep.at, now), now)}
                  selected={dep.deploymentId === openId}
                  leading={<StepMark state={markOf(dep.state)} />}
                  onPress={() => setOpenId(dep.deploymentId)}
                  trailing={
                    <Text style={s.rowWord} testID={`site-preview-${dep.deploymentId}`}>
                      {dep.state === "ready" ? (dep.url ?? "").replace("https://", "") : depState(dep).word}
                    </Text>
                  }
                />
              ))}
              <View style={ui.actions}>
                <TextInput
                  accessibilityLabel="Branch to preview"
                  testID="site-preview-branch"
                  value={branch}
                  onChangeText={setBranch}
                  placeholder="branch name"
                  placeholderTextColor="var(--ink-4)"
                  autoCapitalize="none"
                  style={[ui.input, { flex: 1, minWidth: 200 }]}
                />
                <Button
                  title="Build preview"
                  testID="site-preview-build"
                  disabled={off || branch.trim() === ""}
                  onPress={() => void buildBranch(branch.trim()).then(() => setBranch(""))}
                />
              </View>
            </Card>
          ) : null}
        </View>
      )}
      {wide && opened ? (
        // the app's shared right pane: it opens where the row was pressed, beside the page, and the person can drag its width
        <ResizableColumn
          paneKey="site-deploy-pane"
          defaultWidth={400}
          grow="left"
          min={320}
          style={s.pane as never}
          testID="site-deploy-pane"
          label="Deploy"
        >
          <View style={s.paneHead}>
            <Text style={s.paneTitle}>Deploy</Text>
            <Button title="Close" testID="site-deploy-pane-close" onPress={() => setOpenId(null)} />
          </View>
          {detail}
        </ResizableColumn>
      ) : null}
    </>
  );

  const logsTab = (
    <Card title="App log">
      <TextInput
        accessibilityLabel="Search the log"
        testID="site-log-search"
        value={find}
        onChangeText={setFind}
        placeholder="Search"
        placeholderTextColor="var(--ink-4)"
        autoCapitalize="none"
        style={ui.input}
      />
      <LogLines
        lines={findLines(runLog, find)}
        testID="site-logs"
        empty={find.trim() ? "No line has that." : "Nothing logged yet."}
        height={420}
      />
    </Card>
  );

  const saveEnv = async (entries: readonly EnvEntry[]): Promise<boolean> =>
    (await run("Saving", "sites.env_set", { siteId: id, entries })) !== null;
  const variablesTab = (
    <Variables
      site={x}
      rows={envRows}
      wanted={wanted}
      keys={keys}
      busy={!!busy}
      online={online}
      save={saveEnv}
      {...(envName ? { preset: envName } : {})}
    />
  );
  const domainsTab = (
    <>
      <Card title="Domains">
        {domainRows}
        <View style={ui.actions}>
          <TextInput
            accessibilityLabel="Domain"
            value={domain}
            onChangeText={setDomain}
            placeholder="cx.example.com"
            placeholderTextColor="var(--ink-4)"
            autoCapitalize="none"
            style={[ui.input, { flex: 1, minWidth: 200 }]}
          />
          <Button
            title="Add domain"
            testID="site-add-domain"
            disabled={!!busy || !online || domain.trim() === ""}
            onPress={() =>
              void run("Adding", "sites.domain_add", { siteId: id, domain: domain.trim() }, () => setDomain(""))
            }
          />
        </View>
      </Card>
    </>
  );
  const settingsTab = (
    <>
      <Card title="Source">
        <Text style={ui.text}>{x.source ? sourceLine(x.source) : "Not connected to a repo or folder."}</Text>
      </Card>
      <Webhook site={x} online={online} busy={!!busy} />
      <Card title="Database">
        <Row
          id="addon-postgres"
          title="Postgres"
          note={
            pg
              ? `${pg.state === "ready" ? "Running" : pg.state === "failed" ? "Failed" : "Starting"} · gives DATABASE_URL${pg.detail ? ` · ${pg.detail}` : ""}`
              : "Its own Postgres on this server. The app gets DATABASE_URL."
          }
          trailing={
            pg ? (
              <Button
                title="Remove"
                disabled={!!busy || !online}
                onPress={() => void run("Removing", "sites.addon_remove", { siteId: id, kind: "postgres" })}
              />
            ) : (
              <Button
                title="Add Postgres"
                testID="site-add-postgres"
                disabled={!!busy || !online}
                onPress={() =>
                  void run("Adding Postgres", "sites.addon_add", { siteId: id, kind: "postgres" }, () =>
                    setNote("Postgres is ready. Deploy again so the app gets DATABASE_URL."),
                  )
                }
              />
            )
          }
        />
        <Row
          id="addon-redis"
          title="Redis"
          note={
            redis
              ? `${redis.state === "ready" ? "Running" : "Starting"} · gives REDIS_URL`
              : "Its own Redis. The app gets REDIS_URL."
          }
          trailing={
            redis ? (
              <Button
                title="Remove"
                disabled={!!busy || !online}
                onPress={() => void run("Removing", "sites.addon_remove", { siteId: id, kind: "redis" })}
              />
            ) : (
              <Button
                title="Add Redis"
                disabled={!!busy || !online}
                onPress={() => void run("Adding Redis", "sites.addon_add", { siteId: id, kind: "redis" })}
              />
            )
          }
        />
        {pg?.state === "ready" ? (
          <>
            <Text style={ui.text}>
              Copy an existing database in: the old connection string from a Vault key (Railway's DATABASE_URL), or a
              pg_dump file.
            </Text>
            {keyChips(importKey, setImportKey)}
            <View style={ui.actions}>
              <Button
                title="Copy from that database"
                testID="site-import-key"
                disabled={!!busy || !online || !importKey}
                onPress={() =>
                  void run("Copying the data", "sites.db_import", { siteId: id, fromHandle: importKey }).then((o) => {
                    if (o) setNote((o as { detail: string }).detail);
                  })
                }
              />
              <Button
                title="Upload a pg_dump"
                disabled={!!busy || !online}
                onPress={() =>
                  void pickDump(d).then(
                    async (fileId) => {
                      if (fileId) {
                        const o = await run("Copying the data", "sites.db_import", { siteId: id, fileId });
                        if (o) setNote((o as { detail: string }).detail);
                      }
                    },
                    (e: unknown) => setError(errorMessage(e)),
                  )
                }
              />
            </View>
          </>
        ) : null}
      </Card>
      <Card title="Who can open it">
        <Select
          label="Access"
          value={x.access ?? "space"}
          options={ACCESS}
          disabled={!!busy || !online}
          onChange={(access) => void run("Saving", "sites.update", { siteId: id, access })}
        />
        {x.access === "space" ? (
          <Text style={ui.text}>People in this Space sign in with Vyre the first time they open it on a browser.</Text>
        ) : null}
        {x.access === "password" || !x.passwordSet ? (
          <View style={ui.actions}>
            <TextInput
              accessibilityLabel="Site password"
              testID="site-password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder={x.passwordSet ? "New password" : "Password, 8 or more characters"}
              placeholderTextColor="var(--ink-4)"
              style={[ui.input, { flex: 1, minWidth: 200 }]}
            />
            <Button
              title={x.passwordSet ? "Change password" : "Set password"}
              disabled={!!busy || !online || password.length < 8}
              onPress={() =>
                void run("Saving", "sites.password_set", { siteId: id, password }, () => {
                  setPassword("");
                  setNote("Password saved. Choose Anyone with the password to use it.");
                })
              }
            />
          </View>
        ) : null}
      </Card>
      <Card title="Resources">
        <Text style={ui.text}>
          What it may use on the shared server, so one site cannot slow the others. Takes effect on the next deploy.
        </Text>
        <View style={ui.actions}>
          <Select
            label="CPU"
            value={String(x.limits?.cpus ?? 1)}
            options={CPUS}
            disabled={!!busy || !online}
            onChange={(v) =>
              void run("Saving", "sites.update", {
                siteId: id,
                limits: { ...(x.limits ?? { cpus: 1, memoryMb: 512 }), cpus: Number(v) },
              })
            }
          />
          <Select
            label="Memory"
            value={String(x.limits?.memoryMb ?? 512)}
            options={MEMORY}
            disabled={!!busy || !online}
            onChange={(v) =>
              void run("Saving", "sites.update", {
                siteId: id,
                limits: { ...(x.limits ?? { cpus: 1, memoryMb: 512 }), memoryMb: Number(v) },
              })
            }
          />
          {x.source?.repo ? (
            <Select
              label="Deploy on push"
              value={x.autoDeploy ? "on" : "off"}
              options={[
                { key: "on", title: "Deploys on every push" },
                { key: "off", title: "Deploys only when asked" },
              ]}
              disabled={!!busy || !online}
              onChange={(v) => void run("Saving", "sites.update", { siteId: id, autoDeploy: v === "on" })}
            />
          ) : null}
        </View>
      </Card>
      <Card title="Stop the site">
        <Text style={ui.text}>
          It stops serving its address. The code and the deploys stay, and Publish brings it back.
        </Text>
        {x.live ? (
          <Button
            title="Stop"
            testID="site-stop"
            disabled={off}
            onPress={() => void run("Stopping", "sites.stop", { siteId: id })}
          />
        ) : null}
      </Card>
    </>
  );
  const pages: Record<TabKey, ReactElement> = {
    overview,
    deploys: deploysTab,
    logs: logsTab,
    variables: variablesTab,
    domains: domainsTab,
    settings: settingsTab,
  };
  const deployTitle = building ? "Deploying" : "Deploy";
  const headerBtns = (
    <View style={ui.actions}>
      {x.live && x.url ? (
        <Button title="Open" testID="site-open" onPress={() => d.nav.openUrl?.(x.url as string)} />
      ) : null}
      {x.url ? <Button title="Copy address" onPress={() => copy(x.url as string)} /> : null}
      {building ? <Button title="Cancel" testID="site-deploy-cancel-head" disabled={off} onPress={cancel} /> : null}
      <Button
        title={deployTitle}
        primary
        testID="site-deploy"
        disabled={off || building}
        onPress={() => void deploy()}
      />
      {!x.live && !building && x.lastDeploy?.current ? (
        <Button
          title="Publish"
          testID="site-publish"
          disabled={off}
          onPress={() =>
            void run("Publishing", x.access === "public" ? "sites.promote" : "sites.publish", { siteId: id })
          }
        />
      ) : null}
    </View>
  );

  return (
    <Frame testID="apps-site-detail" title={x.name} back={back} offline={!online} error={error}>
      <View style={s.headLine}>
        <View style={[s.dot, { backgroundColor: TONE_COLOR[word.tone] }]} />
        <Text style={s.stateWord} testID="site-state">
          {building && busy === "Deploying" ? "Starting the deploy" : word.word}
        </Text>
      </View>
      <Text selectable style={ui.text} testID="site-url">
        {x.live && x.url
          ? x.url
          : x.url
            ? `${x.url} (not published)`
            : host.data?.sitesDomain
              ? "It gets its address when the first deploy is live."
              : "It gets an address of its own when this Space has a sites domain or a custom domain."}
      </Text>
      {headerBtns}
      <View accessibilityRole="tablist" style={s.tabs}>
        {/* ui-rows-lint: not a list (the six tabs of the page) */}
        {TABS.map((tb) => (
          <Pressable
            key={tb.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === tb.key }}
            testID={`site-tab-${tb.key}`}
            onPress={() => setTab(tb.key)}
            style={[s.tab, tab === tb.key && s.tabOn]}
          >
            <Text style={[s.tabText, tab === tb.key && s.tabTextOn]}>
              {tb.key === "variables" && envRows.length ? `${tb.title} ${envRows.length}` : tb.title}
            </Text>
          </Pressable>
        ))}
      </View>
      {undo ? (
        <View style={ui.actions} testID="site-undo">
          <Text style={ui.text}>{`Rolled back. ${undo.title} was serving before.`}</Text>
          <Button title="Undo" testID="site-undo-press" disabled={off} onPress={undoRollback} />
        </View>
      ) : null}
      {note ? (
        <Text style={ui.text} testID="site-note">
          {note}
        </Text>
      ) : null}
      {pages[tab]}
    </Frame>
  );
}

/** Choose a dump file and put it in Files; the import reads it from there. */
async function pickDump(d: AppsData): Promise<string | null> {
  const doc = (globalThis as { document?: Document }).document;
  if (!doc) return null;
  const file = await new Promise<File | null>((resolve) => {
    const input = doc.createElement("input");
    input.type = "file";
    input.accept = ".sql,.dump,.backup,application/sql";
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
  if (!file) return null;
  const out = await uploadPicked(d, { name: "Database dump", files: [{ path: file.name, file }] }, () => undefined);
  if (out.fileId) return out.fileId;
  // a single file that is not an archive comes back as its folder: read the file from it
  const list = (await d.call("files.list", { folder: out.folderId })) as { files?: Array<{ fileId: string }> };
  return list.files?.[0]?.fileId ?? null;
}

const s = StyleSheet.create({
  headLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  tabs: { flexDirection: "row", flexWrap: "wrap", gap: 4, borderBottomWidth: 1, borderColor: "var(--line)" as string },
  tab: {
    height: 36,
    paddingHorizontal: 12,
    justifyContent: "center",
    borderBottomWidth: 2,
    borderColor: "transparent",
  },
  tabOn: { borderColor: "var(--accent)" as string },
  tabText: { fontSize: 13, color: "var(--ink-3)" as string },
  tabTextOn: { color: "var(--ink)" as string, fontWeight: "600" },
  pane: { borderLeftWidth: 1, borderLeftColor: "var(--line)" as string },
  paneHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    minHeight: 44,
  },
  paneTitle: { fontSize: 13, fontWeight: "600", color: "var(--ink)" as string },
  paneBack: { gap: 12 },
  rowWord: { fontSize: 12, color: "var(--ink-3)" as string },
  state: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  stateWord: { fontSize: 15, fontWeight: "600", color: "var(--ink)" as string },
  problem: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "var(--danger)" as string,
  },
  problemText: { flex: 1, minWidth: 220, fontSize: 13.5, lineHeight: 20, color: "var(--ink)" as string },
  log: { maxHeight: 320, borderRadius: 8, backgroundColor: "var(--sunk)" as string, padding: 10 },
  logText: { fontFamily: "var(--mono)" as string, fontSize: 11.5, lineHeight: 17, color: "var(--ink-2)" as string },
  mono: { fontFamily: "var(--mono)" as string },
  chips: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  chip: {
    height: 26,
    paddingHorizontal: 10,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "var(--line)" as string,
    justifyContent: "center",
    maxWidth: 220,
  },
  chipOn: { borderColor: "var(--accent)" as string, backgroundColor: "var(--accent-wash)" as string },
  chipText: { fontSize: 12, color: "var(--ink-2)" as string },
});
