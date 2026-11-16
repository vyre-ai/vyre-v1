// Send for signature from the command palette: one list of the PDFs the person worked on lately (and a search over them), then the one signing sheet. Mounted once by the shell; the palette's
// "Send a file for signature" asks for it (places/files/sign/pick.ts).
import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { Dialog } from "../../../../../ui/src/Dialog/index.tsx";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { TextField } from "../../../../../ui/src/TextField/index.tsx";
import { SignDataProvider } from "../../places/files/sign/data.tsx";
import type { SignData } from "../../places/files/sign/data.tsx";
import { onSignRequest, pdfsOf, takeSignRequest } from "../../places/files/sign/pick.ts";
import { SignSheet } from "../../places/files/sign/SignSheet.tsx";
import { notices } from "../noticeslot/model.ts";
import type { ShellRuntime } from "../providers/runtime.tsx";

type Step = { at: "closed" } | { at: "pick" } | { at: "send"; fileId: string; name: string };

export function SignHost({ rt }: { rt: ShellRuntime | null }): ReactElement | null {
  const [step, setStep] = useState<Step>({ at: "closed" });
  const [q, setQ] = useState("");
  const [files, setFiles] = useState<{ fileId: string; name: string; mime: string }[] | null>(null);
  useEffect(() => {
    const open = (): void => {
      if (takeSignRequest()) {
        setQ("");
        setFiles(null);
        setStep({ at: "pick" });
      }
    };
    open();
    return onSignRequest(open);
  }, []);
  useEffect(() => {
    if (step.at !== "pick" || !rt) return undefined;
    let live = true;
    void Promise.resolve(rt.call("files.recent", { limit: 200 })).then(
      (o) => {
        if (live) setFiles((o as { files?: { fileId: string; name: string; mime: string }[] }).files ?? []);
      },
      () => {
        if (live) setFiles([]);
      },
    );
    return () => {
      live = false;
    };
  }, [step.at, rt]);
  const data = useMemo<SignData | null>(
    () =>
      rt
        ? {
            call: rt.call,
            clock: rt.clock,
            ...(rt.baseUrl ? { origin: rt.baseUrl } : {}),
            openFile: (id) => rt.open({ subject: { type: "file", id } }),
            say: (t) => notices.pass(t),
          }
        : null,
    [rt],
  );
  if (step.at === "closed" || !rt || !data) return null;
  const close = (): void => setStep({ at: "closed" });
  if (step.at === "send")
    return (
      <SignDataProvider value={data}>
        <SignSheet fileId={step.fileId} fileName={step.name} onClose={close} />
      </SignDataProvider>
    );
  const list = pdfsOf(files ?? [], q).slice(0, 8);
  return (
    <Dialog
      title="Send for signature"
      onClose={close}
      width={520}
      fill
      testID="sign-picker"
      actions={[{ label: "Cancel", onPress: close, testID: "sign-picker-cancel" }]}
    >
      <View style={st.stack}>
        <TextField
          value={q}
          onChangeText={setQ}
          accessibilityLabel="Find a PDF"
          placeholder="Find a PDF"
          autoCapitalize="none"
          autoCorrect={false}
          testID="sign-picker-search"
          style={st.input}
        />
        {/* ui-rows-lint: not a list (the PDFs to choose from are drawn by one Row each below) */}
        <View testID="sign-picker-list">
          {list.map((f) => (
            <Row
              key={f.fileId}
              id={`sign-pick:${f.fileId}`}
              title={f.name}
              onPress={() => setStep({ at: "send", fileId: f.fileId, name: f.name })}
            />
          ))}
        </View>
        {files !== null && list.length === 0 ? (
          <View testID="sign-picker-empty">
            <Row title={q.trim() === "" ? "No PDFs yet. Upload one in Files." : "No PDF by that name."} inert />
          </View>
        ) : null}
      </View>
    </Dialog>
  );
}

const st = StyleSheet.create({
  stack: { gap: 10 },
  input: { width: "100%" },
});
