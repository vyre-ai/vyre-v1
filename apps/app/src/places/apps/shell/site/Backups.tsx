// Backups of a site's database, in its Database card: how big it is, Back up now, and the backups with their size and when. A backup is a gzipped dump kept on this server. Putting one back replaces
// what is in the database now, so it asks first, in the menu, and says what it will do.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Row } from "../../../../../../../ui/src/Row/index.tsx";
import { useWhenText } from "../../../../../../../ui/src/Time/index.tsx";
import { useAppsData } from "../data.tsx";
import { actionKey, errorMessage, mutate } from "../mutations.ts";
import { Button, TextBox, useRead } from "../editor-ui.tsx";
import { MenuButton, StepMark } from "./parts.tsx";
import { confirmOk, databaseLine, restoreSentence, sizeText } from "./ops-model.ts";
import type { BackupOut } from "./ops-model.ts";

interface Read {
  backups: BackupOut[];
  hasDatabase: boolean;
  database?: { bytes?: number; replacedBytes?: number };
}

export function Backups({ siteId, siteName }: { siteId: string; siteName: string }): ReactElement | null {
  const d = useAppsData();
  const r = useRead<Read>("sites.backups_list", { siteId }, "sites");
  const when = useWhenText();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<BackupOut | null>(null);
  const [typed, setTyped] = useState("");
  const making = (r.data?.backups ?? []).some((b) => b.state === "queued" || b.state === "running");
  useEffect(() => {
    if (!making) return undefined;
    const t = setInterval(() => r.refresh(), 2000);
    return () => clearInterval(t);
  }, [making, r.refresh]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!r.data || !r.data.hasDatabase) return null;
  const now = d.clock().now;
  const call = async (cap: string, input: Record<string, unknown>): Promise<unknown> => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const out = await mutate(d, cap, { siteId, ...input }, actionKey());
      r.refresh();
      return out;
    } catch (e) {
      setError(errorMessage(e));
      return null;
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={s.block} testID="site-backups">
      <View style={s.head}>
        <View style={s.grow}>
          <Text style={s.title}>Backups</Text>
          <Text style={s.hint}>
            {databaseLine(
              r.data.database,
              r.data.backups.some((b) => b.state === "ready"),
            )}
          </Text>
        </View>
        <Button
          title={making ? "Backing up…" : "Back up now"}
          disabled={making || busy}
          testID="site-backup-now"
          onPress={() => void call("sites.backup_create", {})}
        />
      </View>
      {r.data.backups.map((b) => (
        <Row
          key={b.backupId}
          id={b.backupId}
          title={when(b.at, now)}
          note={
            b.state === "failed"
              ? (b.note ?? "It failed.")
              : b.state === "ready"
                ? `${b.bytes !== undefined ? sizeText(b.bytes) : ""}${b.pinned ? " · Kept" : ""}${b.keepUntil ? " · Made before a restore" : ""}`
                : "Backing up…"
          }
          leading={
            <View style={{ marginRight: 10 }}>
              <StepMark state={b.state === "ready" ? "ok" : b.state === "failed" ? "failed" : "running"} />
            </View>
          }
          trailing={
            b.state === "queued" || b.state === "running" ? null : (
              <MenuButton
                title="Actions"
                testID={`site-backup-${b.backupId}`}
                entries={[
                  ...(b.state === "ready"
                    ? [
                        {
                          label: "Put it back",
                          hint: "Keeps a copy of what is there now for 7 days",
                          danger: true,
                          onSelect: () => {
                            setConfirm(b);
                            setTyped("");
                          },
                        },
                        {
                          label: "Download",
                          onSelect: () =>
                            void call("sites.backup_download", { backupId: b.backupId }).then((o) => {
                              const files = (o as { files?: { url: string }[] } | null)?.files ?? [];
                              for (const f of files) globalThis.open?.(f.url, "_blank");
                            }),
                        },
                        {
                          label: b.pinned ? "Let it go when it is old" : "Keep it",
                          onSelect: () => void call("sites.backup_pin", { backupId: b.backupId, pinned: !b.pinned }),
                        },
                        { separator: true as const },
                      ]
                    : []),
                  {
                    label: "Delete",
                    danger: true,
                    onSelect: () => void call("sites.backup_delete", { backupId: b.backupId }),
                  },
                ]}
              />
            )
          }
        />
      ))}
      {confirm ? (
        <View style={s.confirm} testID="site-restore-confirm">
          <Text style={s.confirmText}>{restoreSentence(when(confirm.at, now), confirm.bytes)}</Text>
          <TextBox label={`Type ${siteName} to confirm`} value={typed} onChange={setTyped} placeholder={siteName} />
          <View style={s.actions}>
            <Button
              title="Put it back"
              primary
              disabled={busy || !confirmOk(typed, siteName)}
              testID="site-restore-go"
              onPress={() => {
                const id = confirm.backupId;
                setConfirm(null);
                void call("sites.backup_restore", { backupId: id }).then((o) => {
                  const out = o as { ok?: boolean; detail?: string } | null;
                  if (out?.ok === false) setError(out.detail ?? "It stopped part way.");
                  else if (out?.detail) setNote(out.detail);
                });
              }}
            />
            <Button title="Cancel" onPress={() => setConfirm(null)} />
          </View>
        </View>
      ) : null}
      {note ? <Text style={s.hint}>{note}</Text> : null}
      {error ? <Text style={s.error}>{error}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  block: { gap: 4, paddingTop: 8 },
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  grow: { flex: 1, minWidth: 0 },
  title: { fontSize: 13, fontWeight: "600", color: "var(--ink)" as string },
  hint: { fontSize: 12, color: "var(--ink-3)" as string },
  error: { fontSize: 12.5, color: "var(--danger)" as string },
  confirm: { gap: 10, padding: 14, borderRadius: 10, backgroundColor: "var(--sunk)" as string, marginTop: 6 },
  confirmText: { fontSize: 13, color: "var(--ink)" as string, lineHeight: 19 },
  actions: { flexDirection: "row", gap: 8 },
});
