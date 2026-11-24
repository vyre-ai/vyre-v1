// The Variables tab: each name, where its value comes from (a Vault key for a secret, or the plain value) and where it applies (everywhere, production, previews). Add one, or paste a whole .env:
// the secrets in it go to the Vault as one item and are never shown again, the rest stay as plain values. Saving replaces the list as a whole, so every change starts from the list as it is read.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Row } from "../../../../../../../ui/src/Row/index.tsx";
import type { CapMap } from "../../../../../../../generated/types.ts";
import { useAppsData } from "../data.tsx";
import { Button, Card, Select, s as ui } from "../editor-ui.tsx";
import { errorMessage } from "../mutations.ts";
import { SCOPE_TITLE, entryOf, isSecretVar, mergeEnv, parseEnv } from "./model.ts";
import type { EnvEntry, EnvRow, EnvScope, Site } from "./model.ts";

type Folders = CapMap["vault.folders.list"]["out"];
type Put = CapMap["vault.item.put"]["out"];
const SCOPES = (["production", "previews", "all"] as EnvScope[]).map((key) => ({ key, title: SCOPE_TITLE[key] }));

export interface VariablesProps {
  site: Site;
  rows: readonly EnvRow[];
  wanted: readonly string[];
  keys: readonly { handle: string; name: string }[];
  busy: boolean;
  online: boolean;
  /** Replace the list; resolves true when it was saved. */
  save(entries: readonly EnvEntry[]): Promise<boolean>;
  /** A name the app looks for, set aside to fill in (from the Overview or a failed deploy). */
  preset?: string;
}

export function Variables({ site, rows, wanted, keys, busy, online, save, preset }: VariablesProps): ReactElement {
  const d = useAppsData();
  const [name, setName] = useState(preset ?? "");
  const [kind, setKind] = useState<"secret" | "plain">("secret");
  const [value, setValue] = useState("");
  const [key, setKey] = useState("");
  // a variable applies to production unless it is set wider: a preview runs any branch's code
  const [scope, setScope] = useState<EnvScope>("production");
  const [plainOk, setPlainOk] = useState(false);
  const [paste, setPaste] = useState("");
  const [pasting, setPasting] = useState(false);
  const [say, setSay] = useState<string | null>(null);
  const have = rows.map(entryOf);
  const off = busy || !online || pasting;
  const okName = /^[A-Za-z_][A-Za-z0-9_]*$/.test(name.trim());
  const secretLooking = kind === "plain" && isSecretVar(name.trim(), value);
  const parsed = paste.trim() === "" ? null : parseEnv(paste);
  const secrets = parsed?.vars.filter((v) => v.secret) ?? [];
  const plain = parsed?.vars.filter((v) => !v.secret) ?? [];

  const add = async (): Promise<void> => {
    const n = name.trim();
    const entry: EnvEntry = {
      name: n,
      scope,
      ...(kind === "plain" ? { value, ...(plainOk ? { confirmPlain: true } : {}) } : { vaultHandle: key }),
    };
    if (await save(mergeEnv(have, [entry]).entries)) {
      setName("");
      setValue("");
      setKey("");
      setPlainOk(false);
      setSay("Saved. Deploy again to use it.");
    }
  };

  const addPasted = async (): Promise<void> => {
    if (!parsed || parsed.vars.length === 0) return;
    setPasting(true);
    setSay(null);
    try {
      const added: EnvEntry[] = plain.map((v) => ({ name: v.name, value: v.value, scope }));
      if (secrets.length > 0) {
        const folders = (await d.call("vault.folders.list", { scope: "mine" })) as Folders;
        const folder = folders.folders[0];
        if (!folder) {
          setSay("The Vault has no folder of yours to keep the secrets in. Make one in the Vault, then paste again.");
          return;
        }
        // the secrets are one Vault item; the site names each as a field of it
        const put = (await d.call("vault.item.put", {
          folderId: folder.id,
          name: `${site.name} env ${new Date(d.clock().now).toISOString().slice(0, 16).replace("T", " ")}`,
          kind: "env",
          fields: secrets.map((v) => ({ key: v.name, value: v.value, secret: true })),
          injectIntoDeployments: true,
        })) as Put;
        for (const v of secrets) added.push({ name: v.name, vaultHandle: `${put.item.handle}.${v.name}`, scope });
      }
      const merged = mergeEnv(have, added);
      if (await save(merged.entries)) {
        setPaste("");
        setSay(
          `Added ${added.length - merged.left.length}: ${secrets.length} to the Vault, ${plain.length} as plain values.${merged.left.length ? ` Left out because Vyre sets them: ${merged.left.join(", ")}.` : ""}${parsed.skipped.length ? ` Not read (not NAME=value): ${parsed.skipped.join(", ")}.` : ""} Deploy again to use them.`,
        );
      }
    } catch (e) {
      setSay(errorMessage(e));
    } finally {
      setPasting(false);
    }
  };

  return (
    <>
      <Card title="Variables">
        <Text style={ui.text}>
          A secret takes its value from a Vault key when it deploys and is never shown. A plain value is kept as it is.
          PORT is set for you.
        </Text>
        {rows.length === 0 ? <Text style={ui.text}>None yet.</Text> : null}
        {rows.map((r) => (
          <Row
            key={r.name}
            id={`env-${r.name}`}
            title={r.name}
            note={r.kind === "plain" ? (r.value ? r.value : "Empty") : `Vault · ${r.vaultName}`}
            trailing={
              <View style={s.trail}>
                <Text style={s.scope}>{SCOPE_TITLE[r.scope]}</Text>
                <Button
                  title="Remove"
                  disabled={off}
                  onPress={() => void save(have.filter((e) => e.name !== r.name))}
                />
              </View>
            }
          />
        ))}
        {/* ui-rows-lint: not a list (the names the app looks for, to fill in) */}
        {wanted.length ? (
          <View style={s.chips}>
            <Text style={ui.text}>It also looks for:</Text>
            {wanted.map((n) => (
              <Pressable key={n} onPress={() => setName(n)} style={s.chip}>
                <Text style={s.chipText}>{n}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </Card>
      <Card title="Add one">
        <TextInput
          accessibilityLabel="Variable name"
          testID="site-env-name"
          value={name}
          onChangeText={setName}
          placeholder="NAME"
          placeholderTextColor="var(--ink-4)"
          autoCapitalize="characters"
          style={[ui.input, s.mono]}
        />
        <View style={ui.actions}>
          <Select
            label="Value"
            value={kind}
            options={[
              { key: "secret", title: "A secret, from the Vault" },
              { key: "plain", title: "A plain value" },
            ]}
            disabled={off}
            onChange={(v) => setKind(v as "secret" | "plain")}
          />
          <Select
            label="Applies to"
            value={scope}
            options={SCOPES}
            disabled={off}
            onChange={(v) => setScope(v as EnvScope)}
          />
        </View>
        {kind === "plain" ? (
          <TextInput
            accessibilityLabel="Plain value"
            testID="site-env-value"
            value={value}
            onChangeText={setValue}
            placeholder="Value"
            placeholderTextColor="var(--ink-4)"
            autoCapitalize="none"
            style={[ui.input, s.mono]}
          />
        ) : keys.length === 0 ? (
          <Text style={ui.text}>No Vault keys yet. Add one in the Vault first, or paste a .env below.</Text>
        ) : (
          // ui-rows-lint: not a list (chips to pick one Vault key)
          <View style={s.chips}>
            {keys.slice(0, 16).map((k) => (
              <Pressable
                key={k.handle}
                accessibilityRole="radio"
                accessibilityState={{ checked: key === k.handle }}
                onPress={() => setKey(k.handle)}
                style={[s.chip, key === k.handle && s.chipOn]}
              >
                <Text style={s.chipText} numberOfLines={1}>
                  {k.name}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
        {secretLooking ? (
          <View style={ui.actions} testID="site-env-looks-secret">
            <Text style={ui.text}>That looks like a secret. Put it in the Vault, or say it is plain.</Text>
            <Button
              title={plainOk ? "It is plain" : "It is not a secret"}
              testID="site-env-plain-ok"
              disabled={off}
              onPress={() => setPlainOk(!plainOk)}
            />
          </View>
        ) : null}
        <Button
          title="Add"
          testID="site-env-add"
          disabled={off || !okName || (kind === "secret" ? key === "" : secretLooking && !plainOk)}
          onPress={() => void add()}
        />
      </Card>
      <Card title="Paste a .env">
        <Text style={ui.text}>
          The secrets in it go to the Vault as one item and are never shown again. The rest stay as plain values.
        </Text>
        <TextInput
          accessibilityLabel="Paste a .env"
          testID="site-env-paste"
          value={paste}
          onChangeText={setPaste}
          multiline
          numberOfLines={6}
          placeholder={"NAME=value\nANOTHER=value"}
          placeholderTextColor="var(--ink-4)"
          autoCapitalize="none"
          style={[ui.input, s.mono, s.paste]}
        />
        {parsed ? (
          <Text style={ui.text} testID="site-env-found">
            {parsed.vars.length === 0
              ? "No variable found in that."
              : `${secrets.length} secret${secrets.length === 1 ? "" : "s"} to the Vault (${secrets.map((v) => v.name).join(", ") || "none"}), ${plain.length} plain.`}
          </Text>
        ) : null}
        <Button
          title={pasting ? "Adding" : "Add them"}
          testID="site-env-paste-add"
          disabled={off || !parsed || parsed.vars.length === 0}
          onPress={() => void addPasted()}
        />
      </Card>
      {say ? (
        <Text style={ui.text} testID="site-env-say">
          {say}
        </Text>
      ) : null}
    </>
  );
}

const s = StyleSheet.create({
  trail: { flexDirection: "row", alignItems: "center", gap: 10 },
  scope: { fontSize: 12, color: "var(--ink-3)" as string },
  mono: { fontFamily: "var(--mono)" as string },
  paste: { minHeight: 110, textAlignVertical: "top" },
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
