// Share a folder: the same sheet Records uses (ui/ShareSheet), on the folder through access.share. It reads the shares live, so a change shows at once.
import { notices } from "../noticeslot/model.ts";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { ViewStyle } from "react-native";
import { AccessSheet } from "../../../../../ui/src/AccessSheet/index.tsx";
import type {
  ShareInput,
  ShareItemType,
  ShareResourceType,
  UnshareInput,
} from "../../../../../ui/src/AccessSheet/index.tsx";
import { copyItemLink, shareRows, sheetDirectory, withNotify } from "../../share/rows.ts";
import { States } from "../../../../../ui/src/States/index.tsx";
import { RECORD_LEVELS, sheetModel } from "../../places/records/sharing/model.ts";
import type { SharesOut } from "../../places/records/sharing/model.ts";
import { useDirectory } from "./automations-parts.tsx";
import { capLive, nameLookup } from "./records-live.ts";
import type { ShellRuntime } from "./runtime.tsx";

/** The level a share goes out with. The sheet picks an agent with no level of its own (an agent's role is set elsewhere), and an empty level is refused by the server ("level: not in enum", found 13 Nov 2026
 * when Share with the Assistant failed silently): an agent is given the least that lets it use the item, view (use for a skill). */
export const shareLevelOf = (i: ShareInput, type: string): string =>
  (i.level as string | undefined) || (type === "skill" ? "use" : "view");

const SKILL_LEVELS = ["use", "edit", "manage"] as const;
const FIXED = (Platform.OS === "web" ? "fixed" : "absolute") as ViewStyle["position"];

export function FolderShareSheet({
  rt,
  folderId,
  resource,
  onClose,
  onChanged,
}: {
  rt: ShellRuntime;
  folderId: string;
  /** another resource than a folder (a site, an artifact), with its name */ resource?: {
    type: string;
    id: string;
    name: string;
  };
  onClose(): void;
  /** A share or a removal went through: the caller reads again what it shows about who has access (the sheet has already closed by then). */
  onChanged?(): void;
}): ReactElement {
  // the sheet is titled with the folder's own name
  const [name, setName] = useState(resource?.name ?? "Folder");
  const type = resource?.type ?? "folder";
  useEffect(() => {
    if (resource) return undefined;
    let live = true;
    void Promise.resolve(rt.call("files.list", {})).then(
      (o) => {
        const f = (o as { folders?: Array<{ folderId?: string; id?: string; name: string }> }).folders?.find(
          (x) => (x.folderId ?? x.id) === folderId,
        );
        if (live && f) setName(f.name);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [rt, folderId, resource]);
  const directory = useDirectory(rt);
  const nameOf = useMemo(() => nameLookup(rt), [rt]);
  const q = useMemo(
    () => capLive<SharesOut>(rt, "access.shares_of", { resource: { type, id: folderId } }),
    [rt, type, folderId],
  );
  const state = useSyncExternalStore(q.subscribe, q.getSnapshot, q.getSnapshot);
  const [failed, setFailed] = useState<string | null>(null);
  // The sheet closes itself the moment Share is pressed, so what happened is said where the person still looks: a passing notice in the top bar ("Shared with Ada", or that it did not go through). Before,
  // a share said nothing at all, and a person could not tell whether it had worked (owner, 13 Nov 2026).
  const run = (call: Promise<unknown>, said?: { ok: string; bad: string }): void => {
    setFailed(null);
    call.then(
      () => {
        if (said) notices.pass(said.ok);
        onChanged?.();
      },
      (e: unknown) => {
        const x = e as { error?: { message?: string }; message?: string };
        setFailed(x?.error?.message ?? x?.message ?? "That did not go through.");
        if (said) notices.pass(said.bad);
      },
    );
  };
  const shell = (inner: ReactElement): ReactElement => (
    <View testID="files-share" accessibilityLabel="Share" style={s.layer}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={s.backdrop} />
      <View style={s.center} pointerEvents="box-none">
        {inner}
      </View>
    </View>
  );
  if (state.status !== "ready")
    return shell(
      <View style={s.card}>
        {state.status === "error" ? (
          <States kind="error" message="This could not be opened." />
        ) : (
          <States kind="loading" title="Opening" icon="files" />
        )}
      </View>,
    );
  const m = sheetModel(state.data, nameOf);
  const itemType: ShareItemType = type === "site" ? "artifact" : type === "skill" ? "skill" : "file";
  const rows = shareRows(state.data, nameOf, folderId);
  return shell(
    <View style={s.stack}>
      <AccessSheet
        mode="share"
        itemType={itemType}
        resourceType={type as ShareResourceType}
        resourceId={folderId}
        itemName={name}
        {...(type === "folder" ? { itemLabel: "folder" } : {})}
        target={type === "folder" ? "folder" : "item"}
        {...(type === "site" ? { subtitle: "Artifact. The people you add can open it in Vyre." } : {})}
        spaceName={rt.space.name}
        ownerName={m.owner?.name ?? "Space owner"}
        {...(m.owner ? { ownerId: m.owner.id } : {})}
        levels={type === "skill" ? SKILL_LEVELS : RECORD_LEVELS}
        shares={rows}
        allowExternal={false}
        density="regular"
        directory={sheetDirectory(directory)}
        {...(state.data.mine ? { maxLevel: state.data.mine } : {})}
        meId={rt.me.id}
        notifyPeople
        onMakeOwner={(s) =>
          run(
            rt.call("access.make_owner", {
              resource: { type, id: folderId },
              personId: s.id,
              idempotencyKey: `owner:${folderId}:${s.id}`,
            }),
          )
        }
        onCopyLink={() => copyItemLink(type, folderId, true)}
        onShare={(i: ShareInput, opts) =>
          run(
            rt.call(
              "access.share",
              withNotify({ resource: { type, id: folderId }, subject: i.subject, level: shareLevelOf(i, type) }, opts),
            ),
            {
              ok: `Shared with ${nameOf(i.subject.id)}`,
              bad: `Could not share with ${nameOf(i.subject.id)}. Try again.`,
            },
          )
        }
        onUnshare={(i: UnshareInput) =>
          run(rt.call("access.unshare", { resource: i.resource, subject: i.subject }), {
            ok: `Stopped sharing with ${nameOf(i.subject.id)}`,
            bad: `Could not stop sharing with ${nameOf(i.subject.id)}. Try again.`,
          })
        }
        onClose={onClose}
      />
      {failed ? (
        <Text accessibilityRole="alert" testID="share-error" style={s.error}>
          {failed}
        </Text>
      ) : null}
    </View>,
  );
}

const s = StyleSheet.create({
  layer: { position: FIXED, left: 0, top: 0, right: 0, bottom: 0, zIndex: 2147482000 },
  backdrop: { position: FIXED, left: 0, top: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.28)" as string },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 16 },
  card: {
    width: "100%",
    maxWidth: 520,
    minHeight: 180,
    borderRadius: 14,
    backgroundColor: "var(--raised)" as string,
    overflow: "hidden",
    justifyContent: "center",
  },
  stack: { width: "100%", maxWidth: 520, gap: 8 },
  error: { color: "var(--danger)" as string, fontSize: 12.5, textAlign: "center" },
});
