// Bring in a spreadsheet: one sheet on a record type. Choose a CSV, see each column matched to a field (change any), see what would be new, updated or skipped, bring it in with the count going up,
// and end on a plain summary. The server does the work (modules/import: import.parse_csv, suggest_mapping, preview, commit); no AI account is involved at any step.
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Dialog } from "../../../../../../ui/src/Dialog/index.tsx";
import { choiceRows, useLiveRows, useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { Glyph } from "../sidebar/parts.tsx";
import { attemptKey } from "../../../shell/providers/files-review.ts";
import { pickFiles } from "../../../shell/providers/files-actions.ts";
import { MAX_FILE_BYTES, NOT_A_SHEET, TOO_BIG, counts, defaultMatch, fillable, importLabel, looksLikeCsv, mapped, pick, picksFrom, problem, problemsLine, progressLine, skipReason, summary } from "./model.ts";
import type { Col, Done, Picks, Preview, Target } from "./model.ts";

type Call = (cap: string, input: unknown) => Promise<unknown>;
type Step = "choose" | "match" | "preview" | "working" | "done";

export interface ImportSheetProps {
  call: Call;
  /** The record type the rows go into. */
  type: string;
  /** Its plural, as the sheet and the summary say it ("Contacts"). */
  plural: string;
  onClose(): void;
  /** The file chooser; the page's own unless a test gives one. */
  pick?: typeof pickFiles;
}

const words = (e: unknown): string => (e instanceof Error && e.message !== "" ? e.message : "That did not work. Try again.");

/** A small choice that opens the shared menu under it: the column's field, or one of two settings. */
function Choice({ value, options, onPick, testID, label }: { value: string; options: ReadonlyArray<{ key: string; title: string }>; onPick(key: string): void; testID: string; label: string }): ReactElement {
  const menu = useMenu();
  const rows: MenuEntry[] = choiceRows(options.map((o) => ({ label: o.title, checked: o.key === value, onSelect: () => onPick(o.key) })), false);
  useLiveRows(menu.update, rows);
  const shown = options.find((o) => o.key === value)?.title ?? "Choose";
  return (
    <>
      <Pressable
        accessibilityRole="button" accessibilityLabel={label} testID={testID}
        onPress={(e) => { const r = (e.currentTarget as unknown as { getBoundingClientRect?(): { left: number; bottom: number } })?.getBoundingClientRect?.(); menu.show(rows, r?.left ?? 20, r?.bottom ?? 100, "other"); }}
        style={({ hovered }: { hovered?: boolean }) => [s.choice, hovered === true ? s.choiceOver : null]}
      >
        <Text style={[s.choiceText, value === "" ? s.quiet : null]} numberOfLines={1}>{shown}</Text>
        <Glyph name="chevd" size={11} color="var(--ink-3)" />
      </Pressable>
      {menu.element}
    </>
  );
}

export function ImportSheet({ call, type, plural, onClose, pick: choosePath = pickFiles }: ImportSheetProps): ReactElement {
  const [step, setStep] = useState<Step>("choose");
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [staged, setStaged] = useState<{ importId: string; rows: number; columns: readonly Col[] } | null>(null);
  const [targets, setTargets] = useState<readonly Target[]>([]);
  const [picks, setPicks] = useState<Picks>({});
  const [match, setMatch] = useState("");
  const [onMatch, setOnMatch] = useState<"update" | "skip">("update");
  const [preview, setPreview] = useState<(Preview & { previewToken: string }) | null>(null);
  const [added, setAdded] = useState(0);
  const [done, setDone] = useState<Done | null>(null);
  const key = useRef(attemptKey());
  const alive = useRef(true);
  const before = useRef(0);
  useEffect(() => () => { alive.current = false; }, []);

  const guard = async (work: () => Promise<void>): Promise<void> => {
    setBusy(true); setError("");
    try { await work(); } catch (e) { if (alive.current) setError(words(e)); } finally { if (alive.current) setBusy(false); }
  };

  const choose = (): void => {
    void guard(async () => {
      const [file] = await choosePath({ accept: ".csv,.tsv,.txt,text/csv", multiple: false, testID: "import-file-input" });
      if (!file) return;
      const f = file.file as { size: number; text(): Promise<string> };
      if (!looksLikeCsv({ name: file.name, mime: file.mime })) throw new Error(NOT_A_SHEET);
      if (f.size > MAX_FILE_BYTES) throw new Error(TOO_BIG);
      const text = await f.text();
      const out = (await call("import.parse_csv", { text })) as { importId: string; tables: Array<{ rowCount: number; columns: Col[] }> };
      const table = out.tables[0];
      if (!table) throw new Error("That file has no rows to bring in.");
      const info = (await call("schema.types.get", { type })) as { type?: { fields?: Array<{ key: string; title?: string; type: string }> } };
      const fields = fillable(info.type?.fields ?? []);
      const sug = (await call("import.suggest_mapping", { importId: out.importId, type })) as { mapping: Array<{ column: string; field?: string }> };
      const first = picksFrom(table.columns, sug.mapping, fields);
      if (!alive.current) return;
      setFileName(file.name); setStaged({ importId: out.importId, rows: table.rowCount, columns: table.columns }); setTargets(fields);
      setPicks(first); setMatch(defaultMatch(first)); setStep("match");
    });
  };

  const change = (column: string, field: string): void => {
    const next = pick(picks, column, field);
    setPicks(next);
    if (match !== "" && !Object.values(next).includes(match)) setMatch("");
  };

  const runPreview = (): void => {
    if (!staged) return;
    void guard(async () => {
      const out = (await call("import.preview", { importId: staged.importId, type, mapping: mapped(picks), ...(match !== "" ? { match: [match], onMatch } : {}) })) as Preview & { previewToken: string };
      if (!alive.current) return;
      setPreview(out); setStep("preview");
    });
  };

  const total = async (): Promise<number> => ((await call("records.query", { type, limit: 1 })) as { total?: number }).total ?? 0;

  const settled = async (importId: string): Promise<Done | "staged" | null> => {
    for (let waited = 0; alive.current && waited < 30 * 60_000; waited += 700) {
      const row = ((await call("import.get", { importId }).catch(() => null)) as { import?: Done } | null)?.import;
      if (!row) return null;
      if (row.state === "staged") return "staged";
      if (row.state !== "running") return row;
      await new Promise((r) => setTimeout(r, 700));
    }
    return null;
  };

  const bringIn = (): void => {
    if (!staged || !preview) return;
    setBusy(true); setError("");
    void (async () => {
      try {
        before.current = await total().catch(() => 0);
        setAdded(0); setStep("working");
        // the commit answers when the rows are written; if the connection gives up first, the import is still running and the sheet waits for it
        let refused = "";
        await call("import.commit", { importId: staged.importId, previewToken: preview.previewToken, idempotencyKey: key.current }).catch((e: unknown) => { refused = words(e); });
        const row = await settled(staged.importId);
        if (!alive.current) return;
        if (row === "staged") { setError(refused !== "" ? refused : "The import did not start. Nothing was written. Try again."); setStep("preview"); }
        else if (row === null) { setError("The import did not report back. Look in your list before trying again."); setStep("done"); }
        else { setDone(row); setStep("done"); }
      } catch (e) { if (alive.current) { setError(words(e)); setStep("preview"); } } finally { if (alive.current) setBusy(false); }
    })();
  };

  // while it runs, the table's size says how far it has got
  useEffect(() => {
    if (step !== "working") return undefined;
    const timer = setInterval(() => { void total().then((n) => { if (alive.current) setAdded(Math.max(0, n - before.current)); }, () => undefined); }, 700);
    return () => clearInterval(timer);
  }, [step]);

  const targetOptions = [{ key: "", title: "Leave out" }, ...targets.map((t) => ({ key: t.key, title: t.title }))];
  const matchOptions = [{ key: "", title: "Nothing: add every row" }, ...mapped(picks).map((m) => ({ key: m.field, title: targets.find((t) => t.key === m.field)?.title ?? m.field }))];
  const feeds = mapped(picks).length;

  let body: ReactElement;
  let actions: Array<{ label: string; onPress(): void; primary?: boolean; disabled?: boolean; testID: string }>;
  let title = `Bring in ${plural.toLowerCase()}`;
  if (step === "choose") {
    body = (
      <View style={s.body}>
        <Text style={s.text}>Choose a spreadsheet saved as CSV. You pick where each column goes before anything is written.</Text>
        {error ? <Text style={s.error} accessibilityRole="alert" testID="import-error">{error}</Text> : null}
      </View>
    );
    actions = [{ label: "Cancel", onPress: onClose, testID: "import-cancel" }, { label: busy ? "Reading" : "Choose a file", primary: true, disabled: busy, onPress: choose, testID: "import-choose" }];
  } else if (step === "match" && staged) {
    title = "Match the columns";
    body = (
      <View style={s.body}>
        <Text style={s.text} testID="import-file-line">{`${fileName}: ${staged.rows.toLocaleString("en-US")} ${staged.rows === 1 ? "row" : "rows"}. Each column goes to a field, or stays out.`}</Text>
        <View style={s.list} testID="import-columns">
          {staged.columns.map((c) => (
            <Row key={c.name} id={`import-col-${c.name}`} title={c.name} note={c.sample.filter((x) => x !== "").slice(0, 2).join(", ")} trailing={<Choice value={picks[c.name] ?? ""} options={targetOptions} onPick={(f) => change(c.name, f)} testID={`import-field-${c.name}`} label={`Field for ${c.name}`} />} />
          ))}
        </View>
        <Text style={s.label}>People already here are found by</Text>
        <Choice value={match} options={matchOptions} onPick={setMatch} testID="import-match" label="Find existing rows by" />
        {match !== "" ? (
          <>
            <Text style={s.label}>When a row is already here</Text>
            <Choice value={onMatch} options={[{ key: "update", title: "Update it" }, { key: "skip", title: "Leave it as it is" }]} onPick={(k) => setOnMatch(k === "skip" ? "skip" : "update")} testID="import-onmatch" label="When a row is already here" />
          </>
        ) : null}
        {error ? <Text style={s.error} accessibilityRole="alert" testID="import-error">{error}</Text> : null}
      </View>
    );
    actions = [{ label: "Back", onPress: () => { setError(""); setStep("choose"); }, testID: "import-back" }, { label: busy ? "Checking" : "Preview", primary: true, disabled: busy || feeds === 0, onPress: runPreview, testID: "import-preview" }];
  } else if (step === "preview" && preview) {
    title = "Check before it goes in";
    const go = importLabel(preview);
    body = (
      <View style={s.body}>
        <View style={s.counts} testID="import-counts">
          {counts(preview).map((c) => (
            <View key={c.key} style={s.count} testID={`import-count-${c.key}`}>
              <Text style={s.countNum}>{c.value.toLocaleString("en-US")}</Text>
              <Text style={s.countLabel}>{c.label}</Text>
            </View>
          ))}
        </View>
        {skipReason(preview, onMatch) ? <Text style={s.text} testID="import-skip-reason">{skipReason(preview, onMatch)}</Text> : null}
        {problemsLine(preview) ? <Text style={s.warn} testID="import-problems">{problemsLine(preview)}</Text> : null}
        {preview.errors.slice(0, 5).map((e) => <Text key={`${e.row}-${e.column ?? ""}`} style={s.text}>{problem(e)}</Text>)}
        {error ? <Text style={s.error} accessibilityRole="alert" testID="import-error">{error}</Text> : null}
      </View>
    );
    actions = [{ label: "Back", onPress: () => { setError(""); setStep("match"); }, testID: "import-back" }, { label: go.label, primary: true, disabled: busy || !go.ok, onPress: bringIn, testID: "import-commit" }];
  } else if (step === "working") {
    title = "Bringing them in";
    body = (
      <View style={s.body}>
        <Text style={s.text} testID="import-progress">{progressLine(added, preview?.creates ?? 0, (preview?.updates ?? 0) > 0)}</Text>
        <View style={s.bar}><View style={[s.barFill, { width: `${preview && preview.creates > 0 ? Math.min(100, Math.round((added / preview.creates) * 100)) : 8}%` as unknown as number }]} /></View>
        {error ? <Text style={s.error} accessibilityRole="alert" testID="import-error">{error}</Text> : null}
      </View>
    );
    actions = [];
  } else {
    title = done?.state === "failed" ? "The import stopped" : "Done";
    body = (
      <View style={s.body}>
        {done ? <Text style={s.text} testID="import-summary">{summary(done, plural)}</Text> : null}
        {error ? <Text style={s.error} accessibilityRole="alert" testID="import-error">{error}</Text> : null}
      </View>
    );
    actions = [{ label: `See ${plural.toLowerCase()}`, primary: true, onPress: onClose, testID: "import-done" }];
  }
  return <Dialog title={title} onClose={step === "working" ? () => undefined : onClose} testID="import-sheet" width={460} fill actions={actions} >{body}</Dialog>;
}

const s = StyleSheet.create({
  body: { gap: 8 },
  text: { fontSize: 13, lineHeight: 19, color: "var(--ink-2)" as string },
  label: { fontSize: 12, fontWeight: "500", color: "var(--ink-3)" as string, marginTop: 6 },
  list: { marginHorizontal: -8 },
  choice: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, minHeight: 28, borderRadius: 7, borderWidth: 1, borderColor: "var(--line)" as string, maxWidth: 190 },
  choiceOver: { backgroundColor: "var(--hover)" as string },
  choiceText: { fontSize: 13, color: "var(--ink)" as string, flexShrink: 1 },
  quiet: { color: "var(--ink-3)" as string },
  counts: { flexDirection: "row", gap: 10 },
  count: { flex: 1, gap: 2, padding: 10, borderRadius: 8, backgroundColor: "var(--hover)" as string },
  countNum: { fontSize: 22, fontWeight: "600", color: "var(--ink)" as string },
  countLabel: { fontSize: 12, color: "var(--ink-3)" as string },
  warn: { fontSize: 13, color: "var(--warning, var(--ink-2))" as string },
  error: { fontSize: 12.5, color: "var(--danger)" as string },
  bar: { height: 6, borderRadius: 3, backgroundColor: "var(--hover)" as string, overflow: "hidden" },
  barFill: { height: 6, borderRadius: 3, backgroundColor: "var(--accent)" as string },
});
