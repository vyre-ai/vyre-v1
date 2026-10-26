// The Settings tab (spec 3.7, 2.12): the scope of an Automation and the one move between scopes (Promote to Space, Make a personal copy), the files folder, who owns it, who has access
// (the shared Share sheet), who follows it, whether it can start itself, its webhook address, and the access it runs on. A Personal Automation shared with you says whose access it runs on.
// Changes save as they are made (quiet Saved, Undo where there is a way back). Destructive moves confirm inside the row.
import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import { ShareSheet } from "../../../../../../ui/src/ShareSheet/index.tsx";
import type { ShareInput, ShareRow, UnshareInput } from "../../../../../../ui/src/ShareSheet/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { useAutomationsData } from "../canvas/data.tsx";
import { Face, IconButton, TextButton } from "../canvas/parts.tsx";
import { each } from "../runs/each.ts";
import { useConfigExtras } from "./data.tsx";
import { Glyph } from "./glyphs.tsx";
import { aiKeys, hasWebhook } from "./model.ts";
import type { Automation } from "./model.ts";
import { Overlay } from "./Overlay.tsx";
import { Group, Hint, IconLine, Lab, PickButton, SRow, Switch } from "./parts.tsx";
import { PromoteSheet, usePromotePreview } from "./PromoteSheet.tsx";
import { useSaved } from "./saved.ts";

type SharesOut = CapMap["access.shares_of"]["out"];

export type AccessRow = ShareRow & { through: SharesOut["shares"][number]["through"] };

/** The contract's grants as the Share sheet's rows: direct grants can be raised and removed, the rest come from a group, a role, a folder or the owner. `through` keeps which. */
export function shareRows(out: SharesOut, name: (id: string) => string): AccessRow[] {
  return each(out.shares, (s) => {
    const kind = s.grant.subject.kind;
    return {
      subjectKind: kind === "person" || kind === "group" || kind === "role" || kind === "agent" || kind === "link" ? kind : "agent",
      subjectId: s.grant.subject.id, name: name(s.grant.subject.id), level: s.grant.level,
      via: s.through === "owner" ? "owner" : s.through === "direct" ? "grant" : s.through === "folder" ? "folder" : "space",
      fromFolderId: s.through === "folder" ? s.grant.source ?? null : null,
      through: s.through,
    };
  });
}

const THROUGH_NOTE: Readonly<Record<AccessRow["through"], string | undefined>> = { owner: "Owner", direct: undefined, group: "From a group", role: "From a role", folder: "From the folder" };

export function SettingsTab({ automation, openPromote = false, openShare = false }: { automation: Automation; openPromote?: boolean; openShare?: boolean }): ReactElement {
  const data = useAutomationsData();
  const extras = useConfigExtras();
  const saved = useSaved();
  const { element, show } = useMenu();
  const a = automation;
  const personal = a.kind === "personal";
  const mine = a.ownerId === data.me.id;
  const [promote, setPromote] = useState(openPromote);
  const [share, setShare] = useState(openShare);
  const [rotating, setRotating] = useState(false);
  const preview = usePromotePreview(a.id, personal && mine);
  const shares = useShares(a.id, !personal);
  const webhook = useWebhook(a.id, hasWebhook(a.definition));
  const roster = [...extras.directory.people, ...extras.directory.groups];

  const copy = async (): Promise<void> => {
    await saved.run("Made a personal copy", async () => {
      const out = (await data.call("automations.make_personal_copy", { automationId: a.id, idempotencyKey: `copy-${a.id}-${a.version}` })) as { automation: { id: string } };
      data.nav.openAutomation(out.automation.id);
    });
  };
  const follow = (name: string, id: string): void => { void saved.run(`${name} follows it`, () => data.call("automations.followers.add", { automationId: a.id, follower: id }), () => data.call("automations.followers.remove", { automationId: a.id, follower: id })); };
  const unfollow = (id: string): void => { void saved.run(`${data.name(id)} no longer follows it`, () => data.call("automations.followers.remove", { automationId: a.id, follower: id }), () => data.call("automations.followers.add", { automationId: a.id, follower: id })); };
  const selfTrigger = (on: boolean): void => {
    const prev = a.definition;
    void saved.run(on ? "Can start itself" : "Cannot start itself", () => data.call("automations.update", { automationId: a.id, definition: { ...a.definition, allowSelfTrigger: on }, expectedVersion: a.version }), () => data.call("automations.update", { automationId: a.id, definition: prev, expectedVersion: a.version + 1 }));
  };

  if (personal && !mine) {
    return (
      <View testID="settings-tab" accessibilityLabel="Settings" style={t.body}>
        <Lab first>Scope</Lab>
        <IconLine icon="lock">{`${data.name(a.ownerId)}'s Personal automation, shared with you. It runs on ${data.name(a.ownerId)}'s access.`}</IconLine>
      </View>
    );
  }

  const keys = aiKeys(a.definition, data.name);
  return (
    <View testID="settings-tab" accessibilityLabel="Settings" style={t.body}>
      <Lab first>Scope</Lab>
      <Group testID="scope">
        <SRow
          last minHeight={52} lead={<Glyph name={personal ? "lock" : "people"} size={15} color="var(--ink-2)" />}
          label={personal ? "Personal" : "Space"}
          sub={personal ? "Yours alone. It runs with only the access you already have." : "Bigger than one person. It runs on access given to it, not on anyone's own."}
        >
          {personal ? <TextButton label="Promote to Space" primary testID="promote" onPress={() => setPromote(true)} /> : <TextButton label="Make a personal copy" icon="plus" testID="personal-copy" onPress={() => void copy()} />}
        </SRow>
      </Group>

      {personal ? (
        <>
          <Lab>Runs on your access</Lab>
          <Text testID="runs-on-yours" style={t.para}>
            {preview.phase === "ready"
              ? `${preview.preview.diff.vaultNames.length ? `Your own sign-ins for ${preview.preview.diff.vaultNames.join(", ")}. ` : ""}${preview.preview.diff.connections.length ? `Your own ${preview.preview.diff.connections.join(", ")} connection. ` : ""}${preview.preview.diff.keysToReplace.length ? "Your own AI account for its agent steps. " : ""}If you lose access to something, it stops.`
              : "If you lose access to something, it stops."}
          </Text>
        </>
      ) : (
        <>
          {extras.openFiles ? (
            <>
              <Lab>Files</Lab>
              <View style={t.files}>
                <Glyph name="folder" size={15} color="var(--ink-3)" />
                <Text numberOfLines={1} style={t.filesPath}>{`Space › Automations › ${a.name}`}</Text>
                <TextButton label="Open in Files" icon="open" testID="open-files" onPress={() => extras.openFiles?.(`Automations/${a.name}`)} />
              </View>
            </>
          ) : null}

          <Lab>Owner</Lab>
          <Group testID="owner">
            <SRow last minHeight={44} lead={<Face name={data.name(a.ownerId)} seedId={a.ownerId} size={20} />} label={data.name(a.ownerId)} sub="The accountable person shown on it." />
          </Group>

          <Lab right={<TextButton label="Add" icon="plus" testID="add-access" onPress={() => setShare(true)} />}>Access</Lab>
          <Group testID="access">
            {shares.phase === "ready" ? <AccessSummary rows={shareRows(shares.out, data.name)} /> : <SRow last label="Loading access…" />}
          </Group>
          <Hint>View sees it, its runs and its history. Edit changes and pauses it. Manage also shares and deletes it. Access from a group can be raised here, never lowered.</Hint>
          <View style={t.shareRow}><TextButton label="Share…" testID="share" onPress={() => setShare(true)} /></View>

          <Lab right={<PickButton label="Add a follower" value="Add" testID="add-follower" onPress={(x, y) => show(roster.length ? each(roster.filter((r) => !a.followers.includes(r.id)), (r) => ({ label: r.name, onSelect: () => follow(r.name, r.id) })) : [{ head: "Nobody to add" }], x, y, "other", { label: "Add a follower" })} />}>Followers</Lab>
          {a.followers.length === 0 ? <Text style={t.dim}>Nobody yet.</Text> : (
            <Group testID="followers">
              {a.followers.map((f) => (
                <Row
                  key={f} id={`follower-${f}`} title={data.name(f)} note="Updates only"
                  leading={<View style={t.lead}><Face name={data.name(f)} seedId={f} size={20} /></View>}
                  trailing={<IconButton icon="x" label={`Stop ${data.name(f)} following`} size={22} testID={`unfollow-${f}`} onPress={() => unfollow(f)} />}
                />
              ))}
            </Group>
          )}

          <Lab>Loops</Lab>
          <Group testID="loops">
            <SRow label="Can start itself" sub="Off. A change it makes never starts it again" minHeight={44}><Switch on={a.definition.allowSelfTrigger === true} label="Can start itself" testID="self-trigger" onChange={selfTrigger} /></SRow>
            <SRow last label="Chain depth" sub="An automation that starts another stops at 8 levels" minHeight={44}><Text style={t.value}>8</Text></SRow>
          </Group>

          {webhook.phase === "ready" ? (
            <>
              <Lab>Webhook address</Lab>
              <Group testID="webhook">
                <SRow label="POST to this address" sub={webhook.url} minHeight={48} last={!rotating}>
                  {rotating ? null : <TextButton label="Rotate…" testID="rotate-webhook" onPress={() => setRotating(true)} />}
                </SRow>
                {rotating ? (
                  <SRow last minHeight={44} label="Rotate it? The old address stops working.">
                    <TextButton label="Rotate" testID="confirm-rotate" onPress={() => { void saved.run("Made a new address", async () => { await data.call("automations.webhook_url.rotate", { automationId: a.id, confirm: true }); webhook.reload(); setRotating(false); }); }} />
                    <TextButton label="Cancel" testID="cancel-rotate" onPress={() => setRotating(false)} />
                  </SRow>
                ) : null}
              </Group>
            </>
          ) : null}

          <Lab>Runs on access given to it</Lab>
          <Group testID="runs-on">
            {keys.length === 0 ? <SRow last label="No agent steps" minHeight={40} /> : keys.map((k) => (
              <Row key={k.nodeId} id={`key-${k.nodeId}`} title={k.title} note={`${k.agent} on ${k.key}${k.backup ? `, then ${k.backup}` : ""}`} leading={<View style={t.lead}><Glyph name="key" size={14} color="var(--ink-3)" /></View>} />
            ))}
          </Group>
        </>
      )}

      {saved.note ? (
        <View testID="saved-note" accessibilityLiveRegion="polite" style={t.saved}>
          <Text style={[t.savedText, saved.note.failed && { color: "var(--danger)" as string }]}>{saved.note.text}</Text>
          {saved.note.undo ? <Text accessibilityRole="button" testID="saved-undo" onPress={saved.note.undo} style={t.undo}>Undo</Text> : null}
        </View>
      ) : null}
      {promote ? (
        <Overlay label="Promote to Space" onClose={() => setPromote(false)} testID="promote-overlay">
          <PromoteSheet automation={a} onClose={() => setPromote(false)} {...(preview.phase === "ready" ? { preview: preview.preview } : {})} onPromoted={() => saved.say("Promoted to the Space. History and versions kept.")} />
        </Overlay>
      ) : null}
      {share && shares.phase === "ready" ? (
        <Overlay label="Share" onClose={() => setShare(false)} testID="share-overlay">
          <ShareSheet
            resourceType="automation" resourceId={a.id} resourceName={a.name} target="item" ownerName={data.name(a.ownerId)} levels={["view", "edit", "manage"]} shares={shareRows(shares.out, data.name)} allowExternal={false} density="regular"
            directory={{ people: extras.directory.people, groups: extras.directory.groups, roles: extras.directory.roles, agents: extras.directory.agents }}
            onShare={(i: ShareInput) => { void saved.run("Access changed", async () => { await data.call("access.share", i); shares.reload(); }); }}
            onUnshare={(i: UnshareInput) => { void saved.run("Access removed", async () => { await data.call("access.unshare", i); shares.reload(); }); }}
            onClose={() => setShare(false)}
          />
        </Overlay>
      ) : null}
      {element}
    </View>
  );
}

/** Who has access, as the rows of the group: the owner first, direct grants, then what comes from a group or role. */
function AccessSummary({ rows }: { rows: readonly AccessRow[] }): ReactElement {
  const data = useAutomationsData();
  if (rows.length === 0) return <SRow last label="Only the owner" minHeight={40} />;
  return (
    <>
      {rows.map((r) => (
        <Row
          key={`${r.subjectKind}:${r.subjectId}`} id={`access-${r.subjectId}`} title={r.name} note={THROUGH_NOTE[r.through]}
          leading={<View style={t.lead}><Face name={data.name(r.subjectId)} seedId={r.subjectId} kind={r.subjectKind === "person" ? "person" : "agent"} size={20} /></View>}
          trailing={<Text style={t.value}>{r.level[0]!.toUpperCase() + r.level.slice(1)}</Text>}
        />
      ))}
    </>
  );
}

type SharesState = { phase: "loading" } | { phase: "ready"; out: SharesOut; reload(): void };
function useShares(automationId: string, enabled: boolean): SharesState {
  const data = useAutomationsData();
  const [n, setN] = useState(0);
  const [out, setOut] = useState<SharesOut | null>(null);
  const reload = useCallback(() => setN((x) => x + 1), []);
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    data.call("access.shares_of", { resource: { type: "automation", id: automationId } }).then((o) => { if (live) setOut(o as SharesOut); }).catch(() => { if (live) setOut({ shares: [] }); });
    return () => { live = false; };
  }, [data, automationId, enabled, n]);
  return out ? { phase: "ready", out, reload } : { phase: "loading" };
}

type WebhookState = { phase: "off" } | { phase: "ready"; url: string; reload(): void };
function useWebhook(automationId: string, enabled: boolean): WebhookState {
  const data = useAutomationsData();
  const [n, setN] = useState(0);
  const [url, setUrl] = useState<string | null>(null);
  const reload = useCallback(() => setN((x) => x + 1), []);
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    data.call("automations.webhook_url.get", { automationId }).then((o) => { if (live) setUrl((o as { url: string }).url); }).catch(() => undefined);
    return () => { live = false; };
  }, [data, automationId, enabled, n]);
  return url ? { phase: "ready", url, reload } : { phase: "off" };
}

const t = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingBottom: 24 },
  para: { fontSize: 12.5, lineHeight: 18, color: "var(--ink-2)" as string },
  dim: { fontSize: 12.5, color: "var(--ink-3)" as string },
  value: { fontSize: 13, color: "var(--ink-2)" as string },
  lead: { flexDirection: "row", alignItems: "center", marginRight: 8 },
  files: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 34 },
  filesPath: { flex: 1, minWidth: 0, fontSize: 13, color: "var(--ink)" as string },
  shareRow: { flexDirection: "row", marginTop: 8 },
  saved: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 14 },
  savedText: { fontSize: 12, color: "var(--ink-2)" as string },
  undo: { fontSize: 12, fontWeight: "600", color: "var(--accent)" as string },
});
