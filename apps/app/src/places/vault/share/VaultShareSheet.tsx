// Share a Vault item or folder: the one Access sheet (ui/AccessSheet) over access.shares_of, with the Vault's own levels (Can use without seeing, Can view, Can edit) and its own
// capabilities (vault.share, vault.unshare). It reads the shares after every change, so what the sheet shows is what the server holds. A subscription sign-in is never shareable (the server refuses).
import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { AccessSheet } from "../../../../../../ui/src/AccessSheet/index.tsx";
import type { ShareInput, UnshareInput } from "../../../../../../ui/src/AccessSheet/index.tsx";
import { copyPageLink, shareRows, sheetDirectory, withNotify } from "../../../share/rows.ts";
import type { SharesOut } from "../../../share/rows.ts";
import { useVaultData, usePrincipals } from "../layout/data.tsx";
import { messageOf } from "../connections/actions.ts";

export type VaultShareKind = "vault_item" | "vault_folder";

export function VaultShareSheet({ kind, id, name, onClose, onChanged }: { kind: VaultShareKind; id: string; name: string; onClose(): void; onChanged?(): void }): ReactElement | null {
  const data = useVaultData();
  const names = usePrincipals();
  const [out, setOut] = useState<SharesOut | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const load = useCallback((): void => {
    void Promise.resolve(data.call("access.shares_of", { resource: { type: kind, id } })).then((o) => setOut(o as SharesOut), () => setFailed("This could not be opened."));
  }, [data, kind, id]);
  useEffect(load, [load]);
  const run = (call: Promise<unknown>): void => {
    setFailed(null);
    call.then(() => { load(); onChanged?.(); }, (e: unknown) => setFailed(messageOf(e)));
  };
  if (out === null) return failed ? <Text accessibilityRole="alert" testID="share-error" style={s.error}>{failed}</Text> : null;
  const rows = shareRows(out, names.name, id);
  const owner = out.shares.find((x) => x.through === "owner");
  const people = names.all.filter((p) => p.kind === "person" && p.id !== data.me.id).map((p) => ({ id: p.id, name: p.name }));
  const agents = names.all.filter((p) => p.kind === "agent" && (p as { private?: boolean }).private !== true).map((p) => ({ id: p.id, name: p.name }));
  return (
    <View testID="vault-share">
      <AccessSheet
        mode="share" itemType="vault" resourceType={kind} resourceId={id} itemName={name} itemLabel={kind === "vault_folder" ? "folder" : "item"} target={kind === "vault_folder" ? "folder" : "item"}
        ownerName={owner ? names.name(owner.grant.subject.id) : data.me.name} {...(owner ? { ownerId: owner.grant.subject.id } : {})} spaceName={data.spaceName}
        levels={["use", "view", "manage"]} shares={rows} allowExternal={false} density="regular" directory={sheetDirectory({ people, groups: [], roles: [], agents })}
        {...(out.mine ? { maxLevel: out.mine } : {})}
        meId={data.me.id} notifyPeople onCopyLink={copyPageLink}
        onShare={(i: ShareInput, opts) => run(Promise.resolve(data.call("vault.share", withNotify({ resource: { type: kind, id }, subject: i.subject, level: i.level }, opts))))}
        onUnshare={(i: UnshareInput) => run(Promise.resolve(data.call("vault.unshare", { resource: { type: kind, id }, subject: i.subject })))}
        onClose={onClose}
      />
      {failed ? <Text accessibilityRole="alert" testID="share-error" style={s.error}>{failed}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({ error: { color: "var(--danger)" as string, fontSize: 12.5, textAlign: "center", padding: 8 } });
