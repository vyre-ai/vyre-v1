// Files > Mounts (P-L9e_04): the mount sheet and the Unmount sheet over the Northwind sample. Screens render through react-dom/server over react-native-web; presses are the
// functions the sheets call (model steps, submitMount, removeMount) against the sample's in-memory kernel, so what the tests change is what the next render shows.
import test from "node:test";
import type { ReactElement } from "react";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MountSheet, MountsDataProvider, UnmountSheet, addInput, back, browse, canMount, canNext, chooseSource, crumbs, emptyDraft, isMounted, mountedRows, mountError, next, pick, removeMount, shareInputs,
  submitMount, togglePerson, unmountWords, walkInto, walkTo, whoLabel,
} from "../mounts/index.ts";
import type { BrowseItem, Draft } from "../mounts/index.ts";
import { createSampleMounts, northwindAccounts, northwindMounts, northwindPeople } from "../mounts/sample.ts";
import type { SampleMounts } from "../mounts/sample.ts";

const html = (s: SampleMounts, el: ReactElement): string =>
  renderToStaticMarkup(<MountsDataProvider value={s.data}>{el}</MountsDataProvider>).replaceAll("<!-- -->", "");
const has = (s: string, needle: string): boolean => s.includes(needle);
const noop = (): void => undefined;
const item = (kind: BrowseItem["kind"], ref: string, name: string, o: Partial<BrowseItem> = {}): BrowseItem => ({ ref, name, isFolder: kind !== "github", kind, ...o });

const draftAt = (src: Parameters<typeof chooseSource>[1], picked: BrowseItem, o: Partial<Draft> = {}): Draft => ({ ...next(pick(chooseSource(emptyDraft("fld_github"), src), picked)), ...o });

test("step 1 lists the four sources in order, with the connected account under each; a source with no connection says Connect", () => {
  const s = createSampleMounts();
  const out = html(s, <MountSheet onClose={noop} onMounted={noop} />);
  const at = ["source:google_drive", "source:microsoft", "source:local", "source:github"].map((id) => out.indexOf(`data-testid="row-${id}"`));
  assert.ok(at.every((i) => i >= 0), "four source rows");
  assert.deepEqual([...at].sort((a, b) => a - b), at, "in the prototype's order");
  for (const name of ["Google Drive", "Microsoft 365", "This computer", "GitHub", "irfad@northwind.example", "Irfad&#x27;s MacBook", "irfad7"]) assert.ok(has(out, name), name);
  assert.ok(has(out, 'aria-label="Mount a folder"') && has(out, 'role="dialog"'));
  const off = createSampleMounts({ accounts: { ...northwindAccounts, github: { label: "irfad7", connected: false } } });
  const o2 = html(off, <MountSheet onClose={noop} onMounted={noop} />);
  assert.ok(has(o2, "Not connected") && has(o2, ">Connect<"));
});

test("steps: pick a source, pick a thing, Next is off until something is picked, Back undoes each step", () => {
  let d = emptyDraft("fld_github");
  assert.equal(d.step, 1);
  d = chooseSource(d, "google_drive");
  assert.equal(d.step, 2);
  assert.equal(canNext(d), false);
  assert.equal(next(d).step, 2, "Next with nothing picked does nothing");
  d = pick(d, item("google_drive", "gd:Marketing", "Marketing"));
  assert.equal(canNext(d), true);
  d = next(d);
  assert.equal(d.step, 3);
  assert.equal(canMount(d), true);
  d = back(d);
  assert.equal(d.step, 2);
  d = back(d);
  assert.equal(d.step, 1);
  assert.equal(d.source, null);
});

test("walking into a folder adds a crumb, a crumb takes you back up, and the source root shows none", () => {
  let d = chooseSource(emptyDraft("fld_github"), "google_drive");
  assert.deepEqual(crumbs(d), []);
  d = walkInto(d, item("google_drive", "gd:My Drive", "My Drive"));
  d = walkInto(d, item("google_drive", "gd:My Drive/Client intake", "Client intake"));
  assert.deepEqual(crumbs(d), ["Google Drive", "My Drive", "Client intake"]);
  d = walkTo(d, 1);
  assert.deepEqual(crumbs(d), ["Google Drive", "My Drive"]);
  d = walkTo(d, 0);
  assert.deepEqual(crumbs(d), []);
});

test("step 2 draws the provider's folders as ui/Row lines; an already mounted folder reads Mounted and is dimmed; the crumbs show under a folder", () => {
  const s = createSampleMounts();
  const items = [item("google_drive", "gd:Marketing", "Marketing", { path: "Shared drive" }), item("google_drive", "gd:Sales", "Sales", { path: "Shared drive" })];
  const d: Partial<Draft> = { step: 2, source: "google_drive" };
  const out = html(s, <MountSheet onClose={noop} onMounted={noop} initial={d} preload={{ listing: { items }, mounted: northwindMounts }} />);
  assert.ok(has(out, 'data-testid="row-browse:google_drive:gd:Marketing"') && has(out, 'data-testid="row-browse:google_drive:gd:Sales"'));
  assert.ok(has(out, "Mounted"), "Marketing is already a mount");
  assert.ok(has(out, 'data-testid="row-browse:google_drive:gd:Marketing-leading"') && has(out, 'data-testid="row-browse:google_drive:gd:Marketing-trailing"'));
  assert.ok(has(out, 'data-testid="mount-next"') && has(out, 'aria-disabled="true"'), "Next is off until a pick");
  assert.ok(!has(out, 'data-testid="mount-crumbs"'), "no crumbs at the root");
  const deep = html(s, <MountSheet onClose={noop} onMounted={noop} initial={{ step: 2, source: "google_drive", path: [{ ref: "gd:My Drive", name: "My Drive", kind: "google_drive" }] }} preload={{ listing: { items } }} />);
  assert.ok(has(deep, 'data-testid="mount-crumbs"') && has(deep, "My Drive"));
  assert.equal(isMounted(items[0] as BrowseItem, northwindMounts), true);
  assert.equal(isMounted(items[1] as BrowseItem, northwindMounts), false);
});

test("GitHub step 2 has the search box and repositories with their details; no match says so", () => {
  const s = createSampleMounts();
  const repos = [item("github", "vyre-ai/website", "vyre-ai/website", { path: "Private · TypeScript · 2 h ago" })];
  const out = html(s, <MountSheet onClose={noop} onMounted={noop} initial={{ step: 2, source: "github" }} preload={{ listing: { items: repos }, mounted: northwindMounts }} />);
  assert.ok(has(out, 'placeholder="Search repositories"') && has(out, "vyre-ai/website"));
  const none = html(s, <MountSheet onClose={noop} onMounted={noop} initial={{ step: 2, source: "github", q: "zzz" }} preload={{ listing: { items: [] } }} />);
  assert.ok(has(none, "No repositories match “zzz”"));
});

test("browse asks the provider for the level you are on and tags each item with its kind (Microsoft 365 merges SharePoint and OneDrive)", async () => {
  const s = createSampleMounts();
  const ms = await browse(s.data.call, chooseSource(emptyDraft("fld_github"), "microsoft"), s.data.accounts);
  assert.deepEqual(ms.items.map((i) => i.kind), ["sharepoint", "sharepoint", "sharepoint", "sharepoint", "onedrive"]);
  const od = await browse(s.data.call, walkInto(chooseSource(emptyDraft("fld_github"), "microsoft"), ms.items[4] as BrowseItem), s.data.accounts);
  assert.deepEqual(od.items.map((i) => i.name), ["Documents", "Desktop", "Shared with me"]);
  const inputs = s.calls.filter((c) => c.cap === "mounts.browse").map((c) => c.input as { kind: string; parent?: string; connectionId?: string });
  assert.deepEqual(inputs.map((i) => i.kind), ["sharepoint", "onedrive", "onedrive"]);
  assert.equal(inputs[2]?.parent, "od:OneDrive");
  assert.equal(inputs[0]?.connectionId, "con_ms");
  const gh = await browse(s.data.call, { ...chooseSource(emptyDraft("fld_github"), "github"), q: "northwind" }, s.data.accounts);
  assert.deepEqual(gh.items.map((i) => i.name), ["northwind/intake-api", "northwind/billing-scripts", "northwind/forms"]);
});

test("the mounts.add input follows the source: Drive by reference, this computer by device and path with its copy mode, GitHub by repository and branch", () => {
  const drive = addInput(draftAt("google_drive", item("google_drive", "gd:Sales", "Sales", { path: "Shared drive" })), northwindAccounts);
  assert.deepEqual(drive, {
    into: "fld_github", source: { kind: "google_drive", connectionId: "con_google", ref: "gd:Sales", path: "Shared drive" }, name: "Sales", reviewChanges: true, idempotencyKey: "mount:google_drive:gd:Sales:fld_github",
  });
  const sp = addInput(draftAt("microsoft", item("onedrive", "od:OneDrive/Desktop", "Desktop")), northwindAccounts);
  assert.equal(sp?.source.kind, "onedrive");
  const local = addInput(draftAt("local", item("local", "~/Projects/vyre-site", "vyre-site"), { copy: "live_only", name: "Site" }), northwindAccounts);
  assert.deepEqual(local, {
    into: "fld_github", source: { kind: "local", deviceId: "dev_macbook", localPath: "~/Projects/vyre-site" }, name: "Site", mode: "live_only", reviewChanges: false, idempotencyKey: "mount:local:~/Projects/vyre-site:fld_github",
  });
  const gh = addInput(draftAt("github", item("github", "northwind/billing-scripts", "northwind/billing-scripts"), { branch: " develop " }), northwindAccounts);
  assert.deepEqual(gh?.source, { kind: "github", connectionId: "con_github", ref: "northwind/billing-scripts", branch: "develop" });
  assert.equal(gh?.name, "billing-scripts", "the name defaults to the repository's own name");
  assert.equal(addInput(draftAt("github", item("github", "a/b", "a/b"), { name: "  " }), northwindAccounts), null, "an empty name cannot be mounted");
});

test("step 3 shows the fields of its source: Copy only for this computer, Branch only for GitHub, always Name, Who can see it and Into", () => {
  const s = createSampleMounts();
  const at = (src: Parameters<typeof chooseSource>[1], it: BrowseItem): string =>
    html(s, <MountSheet onClose={noop} onMounted={noop} initial={draftAt("google_drive", it, { source: src })} preload={{ listing: { items: [] } }} />);
  const local = at("local", item("local", "~/Projects/vyre-site", "vyre-site"));
  for (const id of ["mount-name", "mount-who", "mount-into", "mount-copy"]) assert.ok(has(local, `data-testid="${id}"`), id);
  assert.ok(!has(local, 'data-testid="mount-branch"'));
  assert.ok(has(local, "Synced copy") && has(local, "Live only"));
  const gh = at("github", item("github", "northwind/forms", "northwind/forms"));
  assert.ok(has(gh, 'data-testid="mount-branch"') && !has(gh, 'data-testid="mount-copy"'));
  assert.ok(has(gh, "Only you") && has(gh, "GitHub"), "the Into folder and who can see it show their values");
  assert.ok(has(gh, 'data-testid="mount-go"') && has(gh, ">Mount<") && has(gh, 'data-testid="mount-back"'));
});

test("mount: the folder is made, the first sync is a run, the list shows it, and the people chosen get a share", async () => {
  const s = createSampleMounts();
  const d = draftAt("google_drive", item("google_drive", "gd:Sales", "Sales"), { who: { mode: "people", ids: ["usr_maya", "usr_lena"] } });
  const r = await submitMount(s.data.call, d, s.data.accounts, "grp_everyone");
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.name, "Sales");
  assert.match(r.runId, /^run_/);
  assert.ok(s.mounts().some((m) => m.name === "Sales" && m.kind === "google_drive" && m.state === "syncing"));
  const shares = s.calls.filter((c) => c.cap === "access.share").map((c) => c.input as { resource: { type: string; id: string }; subject: { kind: string; id: string }; level: string });
  assert.deepEqual(shares.map((x) => x.subject.id), ["usr_maya", "usr_lena"]);
  assert.ok(shares.every((x) => x.resource.type === "folder" && x.resource.id === r.folderId && x.subject.kind === "person" && x.level === "view"));
  const listed = await mountedRows(s.data.call);
  assert.ok(isMounted(item("google_drive", "gd:Sales", "Sales"), listed), "the browse list now marks it Mounted");
  const everyone = shareInputs({ mode: "everyone" }, "fld_x", "grp_everyone");
  assert.deepEqual(everyone.map((x) => x.subject), [{ kind: "group", id: "grp_everyone" }]);
  assert.deepEqual(shareInputs({ mode: "everyone" }, "fld_x", undefined), []);
});

test("mounting the same folder twice says it is already mounted, and a provider that needs reconnecting says so by name", async () => {
  const s = createSampleMounts();
  const d = draftAt("google_drive", item("google_drive", "gd:Marketing", "Marketing"));
  const dup = await submitMount(s.data.call, d, s.data.accounts);
  assert.deepEqual(dup, { ok: false, error: "That folder is already mounted." });
  s.failNext("mounts.add", "provider.auth_failed");
  const auth = await submitMount(s.data.call, draftAt("microsoft", item("sharepoint", "sp:Proposals", "Proposals")), s.data.accounts);
  assert.deepEqual(auth, { ok: false, error: "Reconnect Microsoft 365, then mount again." });
  assert.equal(mountError(new Error("provider.unavailable"), "GitHub"), "GitHub is not answering. Try again in a minute.");
  assert.equal(mountError(new Error("boom"), "GitHub"), "Could not mount that. Try again.");
  const none = await submitMount(s.data.call, emptyDraft("fld_all"), s.data.accounts);
  assert.deepEqual(none, { ok: false, error: "Pick a folder first." });
});

test("a share that fails after the mount keeps the mount and comes back as a warning", async () => {
  const s = createSampleMounts();
  s.failNext("access.share", "permission.not_contained");
  const r = await submitMount(s.data.call, draftAt("github", item("github", "irfad7/dotfiles", "irfad7/dotfiles"), { who: { mode: "people", ids: ["usr_sam"] } }), s.data.accounts);
  assert.equal(r.ok, true);
  assert.ok(r.ok && r.warning?.startsWith("Mounted dotfiles, but sharing it did not work"));
  assert.ok(s.mounts().some((m) => m.name === "dotfiles"));
});

test("who can see it: Only you by default, a name or a count, and a toggled person comes and goes", () => {
  assert.equal(whoLabel({ mode: "me" }, "Northwind", northwindPeople), "Only you");
  assert.equal(whoLabel({ mode: "everyone" }, "Northwind", northwindPeople), "Everyone in Northwind");
  assert.equal(whoLabel({ mode: "people", ids: ["usr_maya", "usr_omar"] }, "Northwind", northwindPeople), "Maya Chen, Omar Haddad");
  assert.equal(whoLabel({ mode: "people", ids: ["usr_maya", "usr_omar", "usr_sam"] }, "Northwind", northwindPeople), "3 people");
  const one = togglePerson({ mode: "me" }, "usr_maya");
  assert.deepEqual(one, { mode: "people", ids: ["usr_maya"] });
  assert.deepEqual(togglePerson(one, "usr_maya"), { mode: "me" });
});

test("remove: the Unmount sheet says where the files stay; the call keeps or drops the copy; the mount leaves the list", async () => {
  const s = createSampleMounts();
  const row = northwindMounts[0]!;
  const out = html(s, <UnmountSheet mount={row} onClose={noop} onRemoved={noop} />);
  assert.ok(has(out, "Unmount “Marketing”?") && has(out, "The files stay in Google Drive."));
  assert.ok(has(out, 'data-testid="unmount-go"') && has(out, 'data-testid="unmount-cancel"') && has(out, 'data-testid="unmount-keep"'));
  assert.equal(unmountWords(northwindMounts[2]!).body, "The files stay in their folder on your computer.");
  assert.equal(unmountWords(northwindMounts[3]!).body, "The files stay in GitHub.");
  const r = await removeMount(s.data.call, row.mountId, false);
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(s.calls.at(-1), { cap: "mounts.remove", input: { mountId: row.mountId, keepCopy: false } });
  assert.ok(!s.mounts().some((m) => m.mountId === row.mountId));
  assert.deepEqual(await removeMount(s.data.call, row.mountId, true), { ok: false, error: "That mount was already gone." });
  s.failNext("mounts.remove", "permission.denied");
  assert.deepEqual(await removeMount(s.data.call, northwindMounts[1]!.mountId, true), { ok: false, error: "Could not unmount that. Try again." });
});

test("add then remove leaves the list as it started", async () => {
  const s = createSampleMounts();
  const before = s.mounts().map((m) => m.mountId);
  const r = await submitMount(s.data.call, draftAt("local", item("local", "~/Documents/Taxes", "Taxes")), s.data.accounts);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(s.mounts().length, before.length + 1);
  assert.deepEqual(await removeMount(s.data.call, r.mountId, true), { ok: true });
  assert.deepEqual(s.mounts().map((m) => m.mountId), before);
});
