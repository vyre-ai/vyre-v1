import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import { blocksToPlain, compileEmail, EmailBuilder } from "../../../../../../ui/src/EmailBuilder/index.tsx";
import type { EmailSnapshot } from "../../../../../../ui/src/EmailBuilder/index.tsx";
import type { EmailBlock, EmailMode } from "../../../../../../ui/src/EmailBuilder/props.ts";
import { serverBlock, visibleBlock } from "./email-design.ts";
import { useAppsData } from "./data.tsx";
import { actionKey, errorMessage, mutate } from "./mutations.ts";
import { Field, s, useOnline, useRead } from "./editor-ui.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
type Step = CapMap["campaigns.get"]["out"]["steps"][number];
export function CampaignEmail({ step, onChange }: { step: Step; onChange(config: Record<string, unknown>): void }): ReactElement {
  const d = useAppsData(), online = useOnline();
  const [emailId, setEmailId] = useState<string | null>(typeof step.config.emailId === "string" ? step.config.emailId : null);
  const [mode, setMode] = useState<EmailMode>((step.config.designMode as EmailMode | undefined) ?? "plain");
  const [snapshot, setSnapshot] = useState<EmailSnapshot>({ subject: String(step.config.subject ?? ""), previewText: "", blocks: (step.config.designBlocks as EmailBlock[] | undefined) ?? [], html: String(step.config.html ?? ""), plain: String(step.config.text ?? ""), subjectB: typeof step.config.subjectB === "string" ? step.config.subjectB : null });
  const [dirty, setDirty] = useState(false), [status, setStatus] = useState("No changes"), [error, setError] = useState("");
  const [testTo, setTestTo] = useState("");
  const library = useRead<CapMap["email_builder.saved_blocks.list"]["out"]>("email_builder.saved_blocks.list", {}, "campaigns");
  const versions = useRead<CapMap["email_builder.versions"]["out"]>(emailId ? "email_builder.versions" : null, { emailId }, "campaigns");
  const [proposals, setProposals] = useState<Array<{ path: string; before: unknown; after: unknown }>>([]);
  const ask = async (instruction: string): Promise<void> => {
    try { await queue.current; const id = await save(); const out = await d.call("email_builder.ask_diff", { emailId: id, instruction }) as { changes: typeof proposals }; setProposals(out.changes); }
    catch (e) { setError(errorMessage(e)); }
  };
  const suggestSubjects = async (): Promise<void> => {
    try {
      await queue.current; const id = await save();
      const results = await Promise.all(Array.from({ length: 5 }, (_, index) => d.call("email_builder.ask_diff", { emailId: id, instruction: `Suggest subject alternative ${index + 1} of 5. Use a distinct angle. Change only the subject; preserve the body.` }) as Promise<{ changes: typeof proposals }>));
      setProposals(results.flatMap((out) => out.changes.filter((change) => change.path === "/subject")));
    } catch (e) { setError(errorMessage(e)); }
  };
  const accept = (index: number): boolean => {
    const proposal = proposals[index]; if (!proposal) return false;
    const parts = proposal.path.split("/").slice(1);
    let next = snapshot;
    if (["subject", "html", "plain"].includes(parts[0] ?? "") && typeof proposal.after === "string") next = { ...next, [parts[0]!]: proposal.after };
    else if (parts[0] === "mode" && ["blocks", "html", "plain"].includes(String(proposal.after))) setMode(proposal.after === "blocks" ? "visual" : proposal.after as EmailMode);
    else if (parts[0] === "blocks" && /^\d+$/.test(parts[1] ?? "")) {
      const at = Number(parts[1]), blocks = [...snapshot.blocks];
      if (parts.length === 2) { if (proposal.after === null) blocks.splice(at, 1); else blocks[at] = visibleBlock(proposal.after as Parameters<typeof visibleBlock>[0], blocks[at]?.id ?? `accepted-${index}`); }
      else if (parts[2] === "props" && parts.length === 4 && !["__proto__", "constructor", "prototype"].includes(parts[3]!)) { const current = blocks[at]; if (!current) return false; const server = serverBlock(current); blocks[at] = visibleBlock({ ...server, props: { ...server.props, [parts[3]!]: proposal.after } }, current.id); }
      else { setError("This suggestion needs another edit before it can be applied."); return false; }
      next = { ...next, blocks };
    } else { setError("This suggestion changes a setting outside the email content."); return false; }
    editRevision.current++; setSnapshot(next); setDirty(true); return true;
  };
  const queue = useRef(Promise.resolve());
  const idRef = useRef(emailId);
  const editRevision = useRef(0);
  const renderedRevision = editRevision.current;
  const onSaved = useRef(onChange); onSaved.current = onChange;
  const save = async (): Promise<string> => {
    if (!online) throw new Error("Reconnect before saving or sending a test.");
    setStatus("Saving…");
    let id = idRef.current;
    if (!id) { const out = await mutate(d, "email_builder.create", { name: snapshot.subject || "Campaign email", mode: mode === "visual" ? "blocks" : mode }, `campaign-email:${step.key}`); id = out.email.emailId; idRef.current = id; setEmailId(id); }
    if (typeof id !== "string" || !id) throw new Error("The email service did not create a design.");
    const email = { emailId: id, name: snapshot.subject || "Campaign email", mode: mode === "visual" ? "blocks" : mode, subject: snapshot.subject, plain: snapshot.plain, html: snapshot.html, blocks: snapshot.blocks.map(serverBlock) };
    const saved = await mutate(d, "email_builder.save", { emailId: id, email }, actionKey());
    const html = mode === "visual" ? compileEmail(snapshot.blocks, { mode: "send" }) : mode === "html" ? snapshot.html : "";
    const text = mode === "visual" ? blocksToPlain(snapshot.blocks) : snapshot.plain;
    onSaved.current({ emailId: id, subject: snapshot.subject, text, html, designMode: mode, designBlocks: snapshot.blocks, subjectB: snapshot.subjectB ?? null });
    setStatus(`Saved v${saved.version}`); if (editRevision.current === renderedRevision) setDirty(false); setError(""); versions.refresh(); return id;
  };
  useEffect(() => {
    if (!dirty || !online) return;
    const timer = setTimeout(() => { queue.current = queue.current.catch(() => undefined).then(async () => { try { await save(); } catch (e) { setStatus("Not saved"); setError(errorMessage(e)); } }); }, 800);
    return () => clearTimeout(timer);
  }, [snapshot, mode, dirty, online]);
  const sendTest = async (): Promise<void> => {
    if (!testTo.trim()) throw new Error("Enter your own email address for the test first.");
    await queue.current; const id = await save();
    const out = await mutate(d, "email_builder.send_test", { emailId: id, to: testTo.trim() }, actionKey());
    if (out.sent !== true) throw new Error("The provider did not confirm the test email.");
  };
  return <View style={{ gap: 12 }}><Text style={s.text}>Email designs save as versions. Save the campaign afterward to use the updated design in its steps.</Text>
    <Field label="Your email address for test sends" value={testTo} onChange={setTestTo} />
    <View style={{ minHeight: 620 }}><EmailBuilder id={emailId ?? step.key} title="Campaign email" subject={snapshot.subject} subjectB={snapshot.subjectB ?? undefined} plain={snapshot.plain} html={snapshot.html} blocks={snapshot.blocks} mode={mode} saveState={online ? dirty ? "Unsaved changes" : status : "Offline: not saved"}
      savedBlocks={(library.data?.blocks ?? []).map((block) => ({ id: block.blockId, name: block.name, block: visibleBlock(block.block, block.blockId), shared: block.shared }))}
      savedVersions={versions.data?.versions}
      onRestoreSavedVersion={async (version) => {
        if (!emailId) throw new Error("Save the design first.");
        const out = await mutate(d, "email_builder.restore_version", { emailId, version }, actionKey());
        const doc = out.email as CapMap["email_builder.get"]["out"]["email"];
        editRevision.current++; setMode(doc.mode === "blocks" ? "visual" : doc.mode);
        setSnapshot({ subject: doc.subject ?? "", previewText: "", html: doc.html ?? "", plain: doc.plain ?? "", blocks: (doc.blocks ?? []).map((block, index) => visibleBlock(block, `restore-${version}-${index}`)) });
        setDirty(true); setStatus("Restored saved version"); versions.refresh();
      }}
      onMode={(m) => { editRevision.current++; setMode(m); setDirty(true); }} onChange={(next) => { editRevision.current++; setSnapshot(next); setDirty(true); }} onTestSend={sendTest} onAsk={(instruction) => void ask(instruction)} onSuggest={() => void suggestSubjects()}
      diffs={proposals.map((p, index) => ({ id: String(index), summary: `${p.path.replace(/^\//, "").replaceAll("/", " ")}: ${String(p.after ?? "Remove").slice(0, 180)}` }))} onAcceptDiff={(id) => accept(Number(id))}
      onSaveBlock={async (name, block) => { await mutate(d, "email_builder.saved_blocks.save", { name, block: serverBlock(block) }, actionKey()); library.refresh(); }} />
    </View>{error ? <Text accessibilityRole="alert" style={s.text}>{error}</Text> : null}
  </View>;
}
