// A site Vyre builds and runs: its state and address first, then what went wrong with one button to fix it, the build log while a deploy runs, earlier deploys to roll back to, env vars
// from the Vault, its own Postgres or Redis (and copying an old database in), who may open it, CPU and memory, its domains and the app's log. Plain text that updates in place: nothing blinks.
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { useAppsData } from "./data.tsx";
import type { AppsData } from "./data.tsx";
import { actionKey, errorMessage, mutate } from "./mutations.ts";
import { Button, Card, Frame, Select, s as ui, useOnline, useRead } from "./editor-ui.tsx";
import { ago } from "./model.ts";
import { copy, DomainRow } from "./SiteDetail.tsx";
import { uploadPicked } from "./NewSiteSheet.tsx";

type Site = CapMap["sites.get"]["out"]["site"];
type Dep = CapMap["sites.deployments"]["out"]["deployments"][number];
const ACCESS = [{ key: "space", title: "People in this Space" }, { key: "private", title: "Only you and people you share with" }, { key: "password", title: "Anyone with the password" }, { key: "public", title: "Anyone with the address" }] as const;
const CPUS = [{ key: "0.5", title: "Half a CPU" }, { key: "1", title: "1 CPU" }, { key: "2", title: "2 CPUs" }] as const;
const MEMORY = [{ key: "256", title: "256 MB" }, { key: "512", title: "512 MB" }, { key: "1024", title: "1 GB" }, { key: "2048", title: "2 GB" }] as const;
const STATE: Readonly<Record<string, { word: string; color: string }>> = {
  ready: { word: "Live", color: "var(--ok)" }, building: { word: "Deploying", color: "var(--warn)" }, queued: { word: "Waiting to deploy", color: "var(--warn)" },
  failed: { word: "Failed", color: "var(--danger)" }, stopped: { word: "Stopped", color: "var(--ink-4)" },
};
const FIX_TITLE: Readonly<Record<string, string>> = {
  set_env: "Add the env var", add_postgres: "Add Postgres and deploy", add_redis: "Add Redis and deploy", retry: "Deploy again", set_start: "Ask an agent to fix it",
  set_port: "Ask an agent to fix it", open_logs: "Show the whole log", connect_repo: "Change the source", free_space: "Open Settings", more_memory: "Double the memory and deploy",
};

function sourceLine(src: NonNullable<Site["source"]>): string {
  if (src.repo) return `${src.repo.replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "")}${src.branch ? ` (${src.branch})` : ""}${src.root ? `, ${src.root}` : ""}`;
  if (src.fileId) return "An upload in Files";
  if (src.folderId) return "A folder in Files";
  return src.path ?? "A folder";
}

/** The build log of the deploy that is running, read again every second until it ends. */
function useBuildLog(d: AppsData, siteId: string, on: boolean): { lines: string[]; state?: string } {
  const [out, setOut] = useState<{ lines: string[]; state?: string }>({ lines: [] });
  useEffect(() => {
    if (!on) return undefined;
    let live = true;
    const read = (): void => { void (d.call("sites.logs", { siteId, build: true, tail: 400 }) as Promise<{ lines: string[]; state?: string }>).then((o) => { if (live) setOut(o); }, () => undefined); };
    read();
    const t = setInterval(read, 1000);
    return () => { live = false; clearInterval(t); };
  }, [d, siteId, on]);
  return out;
}

function LogBlock({ lines, testID, empty }: { lines: readonly string[]; testID: string; empty: string }): ReactElement {
  const ref = useRef<ScrollView | null>(null);
  useEffect(() => { ref.current?.scrollToEnd({ animated: false }); }, [lines.length]);
  return <ScrollView ref={ref} style={s.log} testID={testID}><Text selectable style={s.logText}>{lines.length ? lines.join("\n") : empty}</Text></ScrollView>;
}

export function DeployedSite({ site: x, refresh, back }: { site: Site; refresh(): void; back(): void }): ReactElement {
  const d = useAppsData(), online = useOnline();
  const id = x.siteId;
  const deps = useRead<CapMap["sites.deployments"]["out"]>("sites.deployments", { siteId: id, limit: 10 }, "sites");
  const env = useRead<CapMap["sites.env_list"]["out"]>("sites.env_list", { siteId: id }, "sites");
  const host = useRead<CapMap["sites.host"]["out"]>("sites.host", {}, "sites");
  const domains = useRead<CapMap["sites.domains_get"]["out"]>("sites.domains_get", { siteId: id }, "sites");
  const [runLog, setRunLog] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null), [error, setError] = useState<string | null>(null), [note, setNote] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [envName, setEnvName] = useState(""), [envKey, setEnvKey] = useState(""), [password, setPassword] = useState(""), [domain, setDomain] = useState(""), [importKey, setImportKey] = useState("");
  const [keys, setKeys] = useState<readonly { handle: string; name: string }[]>([]);
  const building = x.state === "building";
  const build = useBuildLog(d, id, building || showLog);
  const last = x.lastDeploy;
  const wasBuilding = useRef(building);
  // a deploy that ends refreshes the page once: the address, the list and the env reads follow it
  useEffect(() => { if (wasBuilding.current && !building) { deps.refresh(); env.refresh(); } wasBuilding.current = building; }, [building]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!building) return undefined;
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [building, refresh]);
  useEffect(() => {
    let live = true;
    const read = (): void => { void (d.call("sites.logs", { siteId: id, tail: 200 }) as Promise<{ lines: string[] }>).then((o) => { if (live) setRunLog(o.lines); }, () => undefined); };
    read();
    const t = setInterval(read, 4000);
    return () => { live = false; clearInterval(t); };
  }, [d, id]);
  useEffect(() => {
    let live = true;
    void (d.call("vault.items.list", { limit: 200 }) as Promise<CapMap["vault.items.list"]["out"]>).then((o) => { if (live) setKeys(o.items.map((i) => ({ handle: i.handle, name: i.name }))); }, () => undefined);
    return () => { live = false; };
  }, [d]);

  const run = async (label: string, cap: string, input: Record<string, unknown>, after?: () => void): Promise<unknown> => {
    setBusy(label); setError(null); setNote(null);
    try {
      const out = await mutate(d, cap, input, actionKey());
      if ((out as { status?: string })?.status === "held") { d.nav.openTask((out as { taskId: string }).taskId); return out; }
      refresh(); deps.refresh(); env.refresh(); domains.refresh();
      after?.();
      return out;
    } catch (e) { setError(errorMessage(e)); return null; } finally { setBusy(null); }
  };
  const deploy = (): Promise<unknown> => run("Deploying", "sites.deploy", { siteId: id });
  const askAgent = (): void => {
    const first = `My site "${x.name}" does not deploy. Vyre says: ${last?.problem ?? "it failed"}. Look at its build log (sites_logs with build) and fix the project, then deploy it again with sites_deploy.`;
    if (d.nav.ask) d.nav.ask(first); else d.nav.newSite?.();
  };
  const fix = (kind: string): void => {
    if (kind === "retry") void deploy();
    else if (kind === "add_postgres" || kind === "add_redis") void run(kind === "add_postgres" ? "Adding Postgres" : "Adding Redis", "sites.addon_add", { siteId: id, kind: kind === "add_postgres" ? "postgres" : "redis" }).then((o) => { if (o) void deploy(); });
    else if (kind === "more_memory") void run("Saving", "sites.update", { siteId: id, limits: { ...(x.limits ?? { cpus: 1, memoryMb: 512 }), memoryMb: Math.min(8192, (x.limits?.memoryMb ?? 512) * 2) } }).then((o) => { if (o) void deploy(); });
    else if (kind === "open_logs") setShowLog(true);
    else if (kind === "free_space") d.nav.openComputers?.();
    else if (kind === "set_env") { const m = /because (\w+) is not set/.exec(last?.problem ?? ""); if (m) setEnvName(m[1]!); setNote("Pick the Vault key for it below, then deploy again."); }
    else if (kind === "connect_repo") setNote("Change the source: make a new site with the right repo or upload, or give the token for a private repo.");
    else askAgent();
  };

  const st = STATE[x.state] ?? STATE.stopped!;
  const domainRows: ReactElement[] = [];
  for (const row of domains.data?.domains ?? []) domainRows.push(<DomainRow key={row.domain} siteId={id} domain={row.domain} online={online} />);
  const envRows = env.data?.entries ?? [];
  const wanted = env.data?.wanted ?? [];
  const addon = (kind: "postgres" | "redis"): { kind: string; state: string; envName: string; detail?: string } | undefined => x.addons?.find((a) => a.kind === kind);
  const pg = addon("postgres"), redis = addon("redis");
  const keyChips = (on: string, set: (h: string) => void): ReactElement => <View style={s.chips}>{keys.length === 0 ? <Text style={ui.text}>No Vault keys yet. Add one in the Vault first.</Text> : keys.slice(0, 16).map((k) => <Pressable key={k.handle} accessibilityRole="radio" accessibilityState={{ checked: on === k.handle }} onPress={() => set(k.handle)} style={[s.chip, on === k.handle && s.chipOn]}><Text style={s.chipText} numberOfLines={1}>{k.name}</Text></Pressable>)}</View>;

  return <Frame testID="apps-site-detail" title={x.name} back={back} offline={!online} error={error}>
    <Card title="Status">
      <View style={s.state}><View style={[s.dot, { backgroundColor: st.color as string }]} /><Text style={s.stateWord} testID="site-state">{x.blocked ? "Taken down" : building ? (busy === "Deploying" ? "Starting the deploy" : "Deploying") : st.word}</Text></View>
      <Text selectable style={ui.text} testID="site-url">{x.live && x.url ? x.url : x.url ? `${x.url} (not published)` : host.data?.sitesDomain ? "It gets its address when the first deploy is live." : "It gets an address of its own when this Space has a sites domain or a custom domain."}</Text>
      {last ? <Text style={ui.text} testID="site-last">{`${last.state === "failed" ? "Last deploy failed" : last.state === "ready" ? "Deployed" : "Started"} ${ago(last.finishedAt ?? last.at, d.clock().now)}${last.by ? ` by ${last.by === d.me?.id ? "you" : d.nameOf?.(last.by) ?? "a teammate"}` : ""}${last.commit ? ` · ${last.commit.slice(0, 7)}` : ""}`}</Text> : null}
      {x.source ? <Text style={ui.text}>{`From ${sourceLine(x.source)}`}</Text> : null}
      <View style={ui.actions}>
        {x.live && x.url ? <Button title="Open" testID="site-open" onPress={() => d.nav.openUrl?.(x.url as string)} /> : null}
        {x.url ? <Button title="Copy address" onPress={() => copy(x.url as string)} /> : null}
        <Button title={building ? "Deploying" : "Deploy now"} primary testID="site-deploy" disabled={!!busy || building || !online} onPress={() => void deploy()} />
        {x.live ? <Button title="Stop" testID="site-stop" disabled={!!busy || !online} onPress={() => void run("Stopping", "sites.stop", { siteId: id })} />
          : x.access === "public" && x.lastDeploy?.current ? <Button title="Publish" testID="site-publish" disabled={!!busy || !online} onPress={() => void run("Publishing", "sites.promote", { siteId: id })} />
          : !building && x.lastDeploy?.current ? <Button title="Publish" testID="site-publish" disabled={!!busy || !online} onPress={() => void run("Publishing", "sites.publish", { siteId: id })} /> : null}
      </View>
      {note ? <Text style={ui.text} testID="site-note">{note}</Text> : null}
    </Card>

    {last?.state === "failed" && last.problem ? <View style={s.problem} accessibilityRole="alert" testID="site-problem">
      <Text style={s.problemText}>{last.problem}</Text>
      {last.fix ? <Button title={FIX_TITLE[last.fix] ?? "Deploy again"} primary testID="site-fix" disabled={!!busy || !online} onPress={() => fix(last.fix as string)} /> : null}
    </View> : null}

    {building || showLog ? <Card title={building ? "Build log" : "Last build log"}>
      <LogBlock lines={build.lines} testID="site-build-log" empty="Waiting for the server to start the build." />
      {!building ? <Button title="Hide the log" onPress={() => setShowLog(false)} /> : null}
    </Card> : null}

    <Card title="Deploys">
      {(deps.data?.deployments ?? []).length === 0 ? <Text style={ui.text}>None yet.</Text> : (deps.data?.deployments ?? []).map((dep: Dep) => (
        <Row key={dep.deploymentId} id={dep.deploymentId} title={dep.current ? "Live now" : dep.state === "failed" ? "Failed" : dep.state === "building" || dep.state === "queued" ? "Deploying" : "Earlier build"}
          note={`${dep.commit ? `${dep.commit.slice(0, 7)} · ` : ""}${ago(dep.finishedAt ?? dep.at, d.clock().now)}${dep.by ? ` · ${dep.by === d.me?.id ? "you" : d.nameOf?.(dep.by) ?? "a teammate"}` : ""}${dep.problem ? ` · ${dep.problem}` : ""}`}
          trailing={!dep.current && dep.state === "ready" ? <Button title="Roll back" testID={`site-rollback-${dep.deploymentId}`} disabled={!!busy || !online} onPress={() => void run("Rolling back", "sites.rollback", { siteId: id, toDeploymentId: dep.deploymentId })} /> : dep.state === "failed" ? <Button title="Log" onPress={() => setShowLog(true)} /> : undefined} />
      ))}
      {!building && !showLog && last ? <Button title="Show the build log" onPress={() => setShowLog(true)} /> : null}
    </Card>

    <Card title="Env vars">
      <Text style={ui.text}>Each one takes its value from a Vault key when it deploys. Values never show here. PORT is set for you.</Text>
      {envRows.map((e) => <Row key={e.name} id={`env-${e.name}`} title={e.name} note={e.vaultName} trailing={<Button title="Remove" disabled={!!busy || !online} onPress={() => void run("Saving", "sites.env_set", { siteId: id, entries: envRows.filter((r) => r.name !== e.name).map((r) => ({ name: r.name, vaultHandle: r.vaultName })) })} />} />)}
      {wanted.length ? <View style={s.chips}><Text style={ui.text}>It also looks for:</Text>{wanted.map((n) => <Pressable key={n} onPress={() => setEnvName(n)} style={s.chip}><Text style={s.chipText}>{n}</Text></Pressable>)}</View> : null}
      <TextInput accessibilityLabel="Env var name" testID="site-env-name" value={envName} onChangeText={setEnvName} placeholder="NAME" placeholderTextColor="var(--ink-4)" autoCapitalize="characters" style={[ui.input, s.mono]} />
      {keyChips(envKey, setEnvKey)}
      <Button title="Add env var" testID="site-env-add" disabled={!!busy || !online || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(envName.trim()) || !envKey} onPress={() => void run("Saving", "sites.env_set", { siteId: id, entries: [...envRows.filter((r) => r.name !== envName.trim()).map((r) => ({ name: r.name, vaultHandle: r.vaultName })), { name: envName.trim(), vaultHandle: envKey }] }, () => { setEnvName(""); setEnvKey(""); setNote("Saved. Deploy again to use it."); })} />
    </Card>

    <Card title="Database">
      <Row id="addon-postgres" title="Postgres" note={pg ? `${pg.state === "ready" ? "Running" : pg.state === "failed" ? "Failed" : "Starting"} · gives DATABASE_URL${pg.detail ? ` · ${pg.detail}` : ""}` : "Its own Postgres on this server. The app gets DATABASE_URL."}
        trailing={pg ? <Button title="Remove" disabled={!!busy || !online} onPress={() => void run("Removing", "sites.addon_remove", { siteId: id, kind: "postgres" })} /> : <Button title="Add Postgres" testID="site-add-postgres" disabled={!!busy || !online} onPress={() => void run("Adding Postgres", "sites.addon_add", { siteId: id, kind: "postgres" }, () => setNote("Postgres is ready. Deploy again so the app gets DATABASE_URL."))} />} />
      <Row id="addon-redis" title="Redis" note={redis ? `${redis.state === "ready" ? "Running" : "Starting"} · gives REDIS_URL` : "Its own Redis. The app gets REDIS_URL."}
        trailing={redis ? <Button title="Remove" disabled={!!busy || !online} onPress={() => void run("Removing", "sites.addon_remove", { siteId: id, kind: "redis" })} /> : <Button title="Add Redis" disabled={!!busy || !online} onPress={() => void run("Adding Redis", "sites.addon_add", { siteId: id, kind: "redis" })} />} />
      {pg?.state === "ready" ? <>
        <Text style={ui.text}>Copy an existing database in: the old connection string from a Vault key (Railway's DATABASE_URL), or a pg_dump file.</Text>
        {keyChips(importKey, setImportKey)}
        <View style={ui.actions}>
          <Button title="Copy from that database" testID="site-import-key" disabled={!!busy || !online || !importKey} onPress={() => void run("Copying the data", "sites.db_import", { siteId: id, fromHandle: importKey }).then((o) => { if (o) setNote((o as { detail: string }).detail); })} />
          <Button title="Upload a pg_dump" disabled={!!busy || !online} onPress={() => void pickDump(d).then(async (fileId) => { if (fileId) { const o = await run("Copying the data", "sites.db_import", { siteId: id, fileId }); if (o) setNote((o as { detail: string }).detail); } }, (e: unknown) => setError(errorMessage(e)))} />
        </View>
      </> : null}
    </Card>

    <Card title="Who can open it">
      <Select label="Access" value={x.access ?? "space"} options={ACCESS} disabled={!!busy || !online} onChange={(access) => void run("Saving", "sites.update", { siteId: id, access })} />
      {x.access === "space" ? <Text style={ui.text}>People in this Space sign in with Vyre the first time they open it on a browser.</Text> : null}
      {x.access === "password" || !x.passwordSet ? <View style={ui.actions}>
        <TextInput accessibilityLabel="Site password" testID="site-password" value={password} onChangeText={setPassword} secureTextEntry placeholder={x.passwordSet ? "New password" : "Password, 8 or more characters"} placeholderTextColor="var(--ink-4)" style={[ui.input, { flex: 1, minWidth: 200 }]} />
        <Button title={x.passwordSet ? "Change password" : "Set password"} disabled={!!busy || !online || password.length < 8} onPress={() => void run("Saving", "sites.password_set", { siteId: id, password }, () => { setPassword(""); setNote("Password saved. Choose Anyone with the password to use it."); })} />
      </View> : null}
    </Card>

    <Card title="Resources">
      <Text style={ui.text}>What it may use on the shared server, so one site cannot slow the others. Takes effect on the next deploy.</Text>
      <View style={ui.actions}>
        <Select label="CPU" value={String(x.limits?.cpus ?? 1)} options={CPUS} disabled={!!busy || !online} onChange={(v) => void run("Saving", "sites.update", { siteId: id, limits: { ...(x.limits ?? { cpus: 1, memoryMb: 512 }), cpus: Number(v) } })} />
        <Select label="Memory" value={String(x.limits?.memoryMb ?? 512)} options={MEMORY} disabled={!!busy || !online} onChange={(v) => void run("Saving", "sites.update", { siteId: id, limits: { ...(x.limits ?? { cpus: 1, memoryMb: 512 }), memoryMb: Number(v) } })} />
        {x.source?.repo ? <Select label="Deploy on push" value={x.autoDeploy ? "on" : "off"} options={[{ key: "on", title: "Deploys on every push" }, { key: "off", title: "Deploys only when asked" }]} disabled={!!busy || !online} onChange={(v) => void run("Saving", "sites.update", { siteId: id, autoDeploy: v === "on" })} /> : null}
      </View>
    </Card>

    <Card title="Domains">
      {domainRows}
      <View style={ui.actions}>
        <TextInput accessibilityLabel="Domain" value={domain} onChangeText={setDomain} placeholder="cx.example.com" placeholderTextColor="var(--ink-4)" autoCapitalize="none" style={[ui.input, { flex: 1, minWidth: 200 }]} />
        <Button title="Add domain" testID="site-add-domain" disabled={!!busy || !online || domain.trim() === ""} onPress={() => void run("Adding", "sites.domain_add", { siteId: id, domain: domain.trim() }, () => setDomain(""))} />
      </View>
    </Card>

    <Card title="App log">
      <LogBlock lines={runLog} testID="site-logs" empty="Nothing logged yet." />
    </Card>
  </Frame>;
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
  state: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  stateWord: { fontSize: 15, fontWeight: "600", color: "var(--ink)" as string },
  problem: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: "var(--danger)" as string },
  problemText: { flex: 1, minWidth: 220, fontSize: 13.5, lineHeight: 20, color: "var(--ink)" as string },
  log: { maxHeight: 320, borderRadius: 8, backgroundColor: "var(--sunk)" as string, padding: 10 },
  logText: { fontFamily: "var(--mono)" as string, fontSize: 11.5, lineHeight: 17, color: "var(--ink-2)" as string },
  mono: { fontFamily: "var(--mono)" as string },
  chips: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  chip: { height: 26, paddingHorizontal: 10, borderRadius: 13, borderWidth: 1, borderColor: "var(--line)" as string, justifyContent: "center", maxWidth: 220 },
  chipOn: { borderColor: "var(--accent)" as string, backgroundColor: "var(--accent-wash)" as string },
  chipText: { fontSize: 12, color: "var(--ink-2)" as string },
});
