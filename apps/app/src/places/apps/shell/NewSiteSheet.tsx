// New site: one sheet, three ways in. A GitHub repo (and a Vault key when it is private), a folder or .zip from this computer (uploaded to Files first, under Deployments), or an agent that
// builds it in a chat. A repo or an upload becomes a site Vyre builds and runs (sites.create with its source, then sites.deploy); the site page opens at once and its build log streams there.
// It starts as Space only: an internal tool is the common case, and anyone in the Space can open it after signing in.
import { createElement, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { CapMap } from "../../../../../../generated/types.ts";
import { useAppsData } from "./data.tsx";
import type { AppsData } from "./data.tsx";
import { actionKey, errorMessage } from "./mutations.ts";

type Way = "repo" | "upload" | "agent";
interface Picked { name: string; files: Array<{ path: string; file: Blob }> }
const SKIP = /(^|\/)(node_modules|\.git|\.next|\.venv|venv|__pycache__|\.DS_Store)(\/|$)/;
const INLINE = 2 * 1024 * 1024;

const nameFromRepo = (repo: string): string => (repo.trim().replace(/\.git$/, "").split(/[/:]/).filter(Boolean).pop() ?? "").replace(/[-_]+/g, " ").replace(/^./, (c) => c.toUpperCase());

const b64 = async (blob: Blob): Promise<string> => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
};

/** Put what was picked in Files, under Deployments/<name>: one file, or the whole folder with its subfolders. Returns the source the deploy reads. */
export async function uploadPicked(d: AppsData, p: Picked, onProgress: (done: number, of: number) => void): Promise<{ folderId?: string; fileId?: string }> {
  const tree = (await d.call("files.tree", {})) as { roots?: Array<{ key?: string; folderId?: string }> };
  const root = tree.roots?.find((r) => r.key === "deployments")?.folderId;
  if (!root) throw new Error("The Deployments folder in Files is not there. Ask an admin.");
  const made = (await d.call("files.folder.create", { parentId: root, name: `${p.name} ${new Date(d.clock().now).toISOString().slice(0, 16).replace("T", " ")}`, idempotencyKey: actionKey() })) as { folder: { folderId: string } };
  const top = made.folder.folderId;
  const folders = new Map<string, string>([["", top]]);
  const folderOf = async (dir: string): Promise<string> => {
    const have = folders.get(dir);
    if (have) return have;
    const parts = dir.split("/");
    const parent = await folderOf(parts.slice(0, -1).join("/"));
    const f = (await d.call("files.folder.create", { parentId: parent, name: parts[parts.length - 1], idempotencyKey: actionKey() })) as { folder: { folderId: string } };
    folders.set(dir, f.folder.folderId);
    return f.folder.folderId;
  };
  let done = 0;
  let single: string | undefined;
  for (const f of p.files) {
    const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : "";
    const name = f.path.slice(f.path.lastIndexOf("/") + 1);
    const folderId = await folderOf(dir);
    let content: Record<string, unknown>;
    if (f.file.size <= INLINE) content = { base64: await b64(f.file) };
    else {
      const slot = (await d.call("files.upload_url", { size: f.file.size, mime: f.file.type || "application/octet-stream" })) as { blobId: string; url: string };
      const put = await fetch(slot.url, { method: "PUT", body: f.file });
      if (!put.ok) throw new Error(`${f.path} did not upload.`);
      content = { blobId: slot.blobId };
    }
    const out = (await d.call("files.create", { folderId, name, content, idempotencyKey: actionKey() })) as { file: { fileId: string } };
    single = out.file.fileId;
    onProgress(++done, p.files.length);
  }
  return p.files.length === 1 && /\.(zip|tar\.gz|tgz)$/i.test(p.files[0]!.path) ? { fileId: single! } : { folderId: top };
}

/** A hidden file input on the web: a folder (with its relative paths) or a single archive. */
function pick(kind: "folder" | "zip"): Promise<Picked | null> {
  const doc = (globalThis as { document?: Document }).document;
  if (!doc) return Promise.resolve(null);
  return new Promise((resolve) => {
    const input = doc.createElement("input");
    input.type = "file";
    if (kind === "folder") input.setAttribute("webkitdirectory", "");
    else input.accept = ".zip,.tar.gz,.tgz,application/zip";
    input.onchange = () => {
      const list = Array.from(input.files ?? []);
      if (list.length === 0) { resolve(null); return; }
      if (kind === "zip") { const f = list[0]!; resolve({ name: f.name.replace(/\.(zip|tar\.gz|tgz)$/i, ""), files: [{ path: f.name, file: f }] }); return; }
      const rel = (f: File): string => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      const top = rel(list[0]!).split("/")[0] ?? "site";
      const files = list.map((f) => ({ path: rel(f).split("/").slice(1).join("/") || f.name, file: f as Blob })).filter((f) => !SKIP.test(f.path));
      resolve({ name: top, files });
    };
    input.click();
  });
}

export function NewSiteSheet({ onClose, onMade }: { onClose(): void; onMade(siteId: string): void }): ReactElement {
  const d = useAppsData();
  const [way, setWay] = useState<Way>("repo");
  const [repo, setRepo] = useState(""), [branch, setBranch] = useState(""), [root, setRoot] = useState(""), [token, setToken] = useState(""), [name, setName] = useState("");
  const [picked, setPicked] = useState<Picked | null>(null);
  const [busy, setBusy] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
  const [keys, setKeys] = useState<readonly { handle: string; name: string }[]>([]);
  const nameTouched = useRef(false);
  useEffect(() => {
    let live = true;
    void (d.call("vault.items.list", { limit: 200 }) as Promise<CapMap["vault.items.list"]["out"]>).then((o) => { if (live) setKeys(o.items.map((i) => ({ handle: i.handle, name: i.name }))); }, () => undefined);
    return () => { live = false; };
  }, [d]);
  useEffect(() => { if (!nameTouched.current) setName(way === "repo" ? nameFromRepo(repo) : picked?.name ?? ""); }, [way, repo, picked]);

  const go = async (): Promise<void> => {
    setError(null);
    try {
      let source: Record<string, unknown>;
      if (way === "repo") {
        if (!repo.trim()) { setError("Paste the repo's address, like github.com/acme/cx-dashboard."); return; }
        source = { repo: repo.trim().replace(/^(https?:\/\/)?github\.com\//, ""), ...(branch.trim() ? { branch: branch.trim() } : {}), ...(root.trim() ? { root: root.trim() } : {}), ...(token ? { tokenHandle: token } : {}) };
      } else {
        if (!picked) { setError("Choose a folder or a .zip first."); return; }
        setBusy("Uploading");
        source = { ...(await uploadPicked(d, picked, (n, of) => setBusy(`Uploading ${n} of ${of}`))), ...(root.trim() ? { root: root.trim() } : {}) };
      }
      setBusy("Starting the deploy");
      const site = ((await d.call("sites.create", { name: name.trim() || "New site", source, idempotencyKey: actionKey() })) as { site: { siteId: string } }).site;
      await d.call("sites.deploy", { siteId: site.siteId, source });
      onMade(site.siteId);
    } catch (e) { setError(errorMessage(e)); setBusy(null); }
  };

  const tab = (k: Way, title: string): ReactElement => (
    <Pressable key={k} accessibilityRole="tab" accessibilityState={{ selected: way === k }} testID={`new-site-${k}`} onPress={() => { setWay(k); setError(null); }} style={[s.tab, way === k && s.tabOn]}><Text style={[s.tabText, way === k && s.tabTextOn]}>{title}</Text></Pressable>
  );
  return <View style={s.scrim} testID="new-site-sheet">
    <Pressable accessibilityLabel="Close" style={StyleSheet.absoluteFill} onPress={busy ? undefined : onClose} />
    <View style={s.sheet} accessibilityRole="none" aria-modal>
      <Text accessibilityRole="header" style={s.title}>New site</Text>
      <Text style={s.sub}>Vyre builds it and runs it on this Space's server, like Railway. Only people in this Space can open it until you change that.</Text>
      <View style={s.tabs} accessibilityRole="tablist">{[tab("repo", "GitHub repo"), tab("upload", "Folder or zip"), tab("agent", "Ask an agent")]}</View>
      {way === "repo" ? <View style={s.body}>
        <Label text="Repo" /><TextInput testID="new-site-repo" accessibilityLabel="Repo" value={repo} onChangeText={setRepo} placeholder="github.com/acme/cx-dashboard" placeholderTextColor="var(--ink-4)" autoCapitalize="none" autoCorrect={false} style={s.input} />
        <View style={s.two}>
          <View style={s.half}><Label text="Branch" /><TextInput accessibilityLabel="Branch" value={branch} onChangeText={setBranch} placeholder="main" placeholderTextColor="var(--ink-4)" autoCapitalize="none" style={s.input} /></View>
          <View style={s.half}><Label text="App folder (optional)" /><TextInput accessibilityLabel="App folder" value={root} onChangeText={setRoot} placeholder="apps/web" placeholderTextColor="var(--ink-4)" autoCapitalize="none" style={s.input} /></View>
        </View>
        <Label text="Private repo: a GitHub token from the Vault" />
        <View style={s.keys}>
          <Chip on={token === ""} title="Public repo" onPress={() => setToken("")} />
          {keys.slice(0, 12).map((k) => <Chip key={k.handle} on={token === k.handle} title={k.name} onPress={() => setToken(k.handle)} />)}
        </View>
      </View> : null}
      {way === "upload" ? <View style={s.body}>
        <Text style={s.text}>The project without node_modules: a folder, or a .zip like GitHub's Download ZIP.</Text>
        <View style={s.row}>
          <Btn title="Choose a folder" testID="new-site-folder" onPress={() => void pick("folder").then((p) => { if (p) setPicked(p); })} />
          <Btn title="Choose a .zip" testID="new-site-zip" onPress={() => void pick("zip").then((p) => { if (p) setPicked(p); })} />
        </View>
        {picked ? <Text style={s.text} testID="new-site-picked">{picked.files.length === 1 ? picked.files[0]!.path : `${picked.name}: ${picked.files.length} files`}</Text> : null}
        <Label text="App folder inside it (optional)" /><TextInput accessibilityLabel="App folder" value={root} onChangeText={setRoot} placeholder="apps/web" placeholderTextColor="var(--ink-4)" autoCapitalize="none" style={s.input} />
      </View> : null}
      {way === "agent" ? <View style={s.body}>
        <Text style={s.text}>Tell an agent what you want. It builds it, deploys it here and gives you the address. It can also move a project you already have.</Text>
      </View> : null}
      {way !== "agent" ? <><Label text="Name" /><TextInput testID="new-site-name" accessibilityLabel="Name" value={name} onChangeText={(v) => { nameTouched.current = true; setName(v); }} placeholder="CX dashboard" placeholderTextColor="var(--ink-4)" style={s.input} /></> : null}
      {error ? <Text style={s.error} accessibilityRole="alert" testID="new-site-error">{error}</Text> : null}
      <View style={s.foot}>
        <Btn title="Cancel" onPress={onClose} disabled={!!busy} />
        {way === "agent"
          ? <Btn primary title="Open a chat" testID="new-site-ask" onPress={() => { onClose(); d.nav.newSite?.(); }} />
          : <Btn primary title={busy ?? "Deploy"} testID="new-site-deploy" disabled={!!busy} onPress={() => void go()} />}
      </View>
    </View>
  </View>;
}

function Label({ text }: { text: string }): ReactElement { return <Text style={s.label}>{text}</Text>; }
function Chip({ title, on, onPress }: { title: string; on: boolean; onPress(): void }): ReactElement {
  return <Pressable accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={onPress} style={[s.chip, on && s.chipOn]}><Text style={[s.chipText, on && s.chipTextOn]} numberOfLines={1}>{title}</Text></Pressable>;
}
function Btn({ title, onPress, primary, disabled, testID }: { title: string; onPress(): void; primary?: boolean; disabled?: boolean; testID?: string }): ReactElement {
  return createElement(Pressable, { accessibilityRole: "button", disabled, onPress, testID, style: [s.btn, primary && s.btnPrimary, disabled && { opacity: 0.5 }] }, <Text style={[s.btnText, primary && s.btnPrimaryText]}>{title}</Text>);
}

const s = StyleSheet.create({
  scrim: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.32)", zIndex: 50, padding: 16 },
  sheet: { width: "100%", maxWidth: 520, maxHeight: "100%", borderRadius: 14, padding: 22, gap: 10, backgroundColor: "var(--raised)" as string, boxShadow: "var(--sh-pop)" } as object,
  title: { fontSize: 17, fontWeight: "600", color: "var(--ink)" as string },
  sub: { fontSize: 13, lineHeight: 19, color: "var(--ink-3)" as string },
  tabs: { flexDirection: "row", gap: 4, padding: 3, borderRadius: 9, backgroundColor: "var(--sunk)" as string, alignSelf: "flex-start", marginTop: 4 },
  tab: { paddingHorizontal: 12, height: 28, justifyContent: "center", borderRadius: 7 },
  tabOn: { backgroundColor: "var(--raised)" as string, boxShadow: "var(--sh-1)" } as object,
  tabText: { fontSize: 12.5, color: "var(--ink-3)" as string },
  tabTextOn: { color: "var(--ink)" as string, fontWeight: "500" },
  body: { gap: 8, marginTop: 6 },
  label: { fontSize: 12, color: "var(--ink-3)" as string, marginTop: 4 },
  input: { height: 34, borderWidth: 1, borderColor: "var(--field-line)" as string, borderRadius: 8, paddingHorizontal: 10, fontSize: 13, color: "var(--ink)" as string, backgroundColor: "var(--field)" as string },
  two: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  half: { flex: 1, minWidth: 160, gap: 6 },
  keys: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { height: 26, paddingHorizontal: 10, borderRadius: 13, borderWidth: 1, borderColor: "var(--line)" as string, justifyContent: "center", maxWidth: 200 },
  chipOn: { borderColor: "var(--accent)" as string, backgroundColor: "var(--accent-wash)" as string },
  chipText: { fontSize: 12, color: "var(--ink-2)" as string },
  chipTextOn: { color: "var(--ink)" as string },
  row: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  text: { fontSize: 13, lineHeight: 19, color: "var(--ink-2)" as string },
  error: { fontSize: 13, color: "var(--danger)" as string },
  foot: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 10 },
  btn: { height: 30, paddingHorizontal: 12, borderRadius: 8, justifyContent: "center", borderWidth: 1, borderColor: "var(--line)" as string },
  btnPrimary: { backgroundColor: "var(--accent)" as string, borderColor: "var(--accent)" as string },
  btnText: { fontSize: 13, fontWeight: "500", color: "var(--ink)" as string },
  btnPrimaryText: { color: "var(--accent-ink)" as string },
});
