// The Connect an app sheet (owner, 13 Nov 2026, design 2.4 and 4F): one sheet on the app's shared frame. What is in his Vault (Set up), what the Space has that he may not use (Ask the admin),
// Another app (Describe it), and Add an app inside the sheet so he never leaves the builder. Adding hands the sheet's body to the credential card (one component, b-skill and the Vault) through `renderAdd`.
import { Fragment, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { AppLogo } from "../../../../../../ui/src/AppLogo/index.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { Dialog } from "../../../../../../ui/src/Dialog/index.tsx";
import { glyphOf, tintOf } from "./glyphs.ts";
import { addAppChoices, connectSheet } from "./model.ts";
import type { AddChoice, PickApp } from "./model.ts";

export interface ConnectSheetProps {
  apps: readonly PickApp[];
  /** The apps Vyre knows how to connect, for the Add an app search. */
  known: readonly { id: string; name: string }[];
  justAdded?: string | undefined;
  onSetup(appId: string): void;
  onAsk(appId: string): void;
  onDescribe(): void;
  onClose(): void;
  onOpenVault?(): void;
  /** The credential card for the chosen app, drawn in place of the list. `back` returns to the list. */
  renderAdd?(choice: AddChoice, back: () => void): ReactNode;
  iconOf?(appId: string): string | undefined;
}

export function ConnectSheet(p: ConnectSheetProps): ReactElement {
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState<AddChoice | null>(null);
  const sheet = connectSheet({ apps: p.apps, justAdded: p.justAdded });
  const choices = addAppChoices(query, p.known);
  const added = p.justAdded ? p.apps.find((a) => a.id === p.justAdded) : undefined;
  return (
    <Dialog title="Connect an app" onClose={p.onClose} width={480} fill testID="connect-sheet">
      {adding && p.renderAdd ? (
        p.renderAdd(adding, () => setAdding(null))
      ) : (
        <View style={styles.body}>
          {added ? (
            <View style={styles.note}>
              <Text style={styles.noteText}>{`Added to your Vault. ${added.name} is ready.`}</Text>
              {p.onOpenVault ? (
                <Pressable testID="cs-open-vault" accessibilityRole="button" onPress={p.onOpenVault}>
                  <Text style={styles.link}>Open in Vault</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {/* ui-rows-lint: not a list (section headings, each followed by its ui/Row items) */}
          {sheet.sections.map((s) => (
            <Fragment key={s.head}>
              <Text style={styles.head}>{s.head}</Text>
              {s.rows.map((r) => {
                const act = (): void =>
                  r.action.kind === "setup"
                    ? p.onSetup(r.id)
                    : r.action.kind === "ask"
                      ? p.onAsk(r.id)
                      : p.onDescribe();
                return (
                  <Row
                    key={r.id}
                    id={`cs-${r.id}`}
                    title={r.name}
                    {...(r.item ? { note: r.item } : {})}
                    domProps={{ style: { minHeight: 48 } }}
                    leading={
                      <View style={{ marginRight: 10 }}>
                        {r.id === "another" ? (
                          <AppLogo
                            app="vyre:plug"
                            name="Another app"
                            size={28}
                            glyph={glyphOf({ app: "vyre:plug", name: "" })}
                            tint={tintOf({ app: "vyre:plug", name: "" })}
                          />
                        ) : (
                          <AppLogo app={r.id} name={r.name} size={28} iconUrl={p.iconOf?.(r.id)} />
                        )}
                      </View>
                    }
                    trailing={
                      r.action.kind === "ready" ? (
                        <Text style={styles.quiet}>{r.action.label}</Text>
                      ) : (
                        <Pressable
                          testID={`cs-act-${r.id}`}
                          accessibilityRole="button"
                          onPress={act}
                          style={styles.btn}
                        >
                          <Text style={styles.btnText}>{r.action.label}</Text>
                        </Pressable>
                      )
                    }
                    {...(r.action.kind === "ready" ? {} : { onPress: act })}
                  />
                );
              })}
            </Fragment>
          ))}
          <Text style={styles.head}>Add an app</Text>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Which app?"
            placeholderTextColor="var(--ink-3)"
            accessibilityLabel="Which app?"
            testID="cs-add-search"
            style={[styles.search, { outlineStyle: "none" } as object]}
          />
          {choices.map((c) => (
            <Row
              key={c.kind === "known" ? c.id : "custom"}
              id={`cs-add-${c.kind === "known" ? c.id : "custom"}`}
              title={c.label}
              leading={
                <AppLogo
                  app={c.kind === "known" ? c.id : c.name}
                  name={c.kind === "known" ? c.label : c.name}
                  size={28}
                  iconUrl={c.kind === "known" ? p.iconOf?.(c.id) : undefined}
                />
              }
              onPress={() => (p.renderAdd ? setAdding(c) : undefined)}
            />
          ))}
        </View>
      )}
    </Dialog>
  );
}

const styles = StyleSheet.create({
  body: { gap: 2 },
  head: { fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" as string, paddingTop: 12, paddingBottom: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44, paddingVertical: 4 },
  text: { flex: 1, minWidth: 0 },
  title: { fontSize: 13, lineHeight: 18, color: "var(--ink)" as string },
  quiet: { fontSize: 12, lineHeight: 16, color: "var(--ink-3)" as string },
  btn: { paddingHorizontal: 8, height: 28, alignItems: "center", justifyContent: "center" },
  btnText: { fontSize: 13.5, fontWeight: "600", color: "var(--ink)" as string },
  search: {
    height: 36,
    paddingHorizontal: 12,
    fontSize: 13,
    color: "var(--ink)" as string,
    borderRadius: 12,
    backgroundColor: "var(--sunk)" as string,
  },
  note: { flexDirection: "row", gap: 10, alignItems: "center", paddingVertical: 6 },
  noteText: { fontSize: 12.5, color: "var(--ink-2)" as string },
  link: { fontSize: 12.5, color: "var(--accent)" as string },
});
