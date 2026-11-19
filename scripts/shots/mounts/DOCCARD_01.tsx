// Mount for lane r42-docs: the approval card of a held "Send for signature" of a preview copy (a copy in the plain page look). The server's own sentence sits quietly under the title and the names it goes to
// are shown apart from it. ?part=plain (with the note) or ordinary (the same hold without one).
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { ApprovalCard } from "../../../apps/app/src/places/chats/conversation/approval.tsx";

export const title = "Approval card, preview copy";

const NOTE = "This sends a preview copy of the file for signature. It's in the plain page look, not the Word template's layout. Allow sends it as it is.";
const task = (plain: boolean) => ({
  task: {
    id: "tsk_9",
    kind: "approve",
    title: "Approve: Send a document for signature",
    state: "awaiting_approval",
    blocks: [
      {
        type: "file",
        v: 1,
        data: {
          act: "signature_send",
          cap: "esign.send",
          input: { fileId: "fil_1", signers: [{ name: "Andrea Lindahl" }, { name: "Sam Okafor" }], ...(plain ? { plainOk: true } : {}) },
          ...(plain ? { note: NOTE, noteSigners: ["Andrea Lindahl", "Sam Okafor"] } : {}),
        },
      },
    ],
    actions: [
      { key: "approve", label: "Approve" },
      { key: "reject", label: "Send back", note: "required" },
    ],
  },
});

export default function Mount(): ReactNode {
  const height = useWindowDimensions().height;
  const [part, setPart] = useState<string | null>(null);
  useEffect(() => {
    setPart(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("part") ?? "plain");
  }, []);
  const data = {
    call: async (cap: string) => (cap === "tasks.get" ? task(part !== "ordinary") : cap === "files.get" ? { file: { name: "Service agreement.pdf" } } : {}),
    nav: { openBeside: () => undefined },
    threadId: "thr_1",
    changes: { subscribe: () => () => undefined },
  } as never;
  return (
    <View style={{ height, padding: 24, backgroundColor: "var(--win)" as string }}>
      {part ? <ApprovalCard key={part} taskId="tsk_9" agent="Intake" agentId="agt_1" data={data} /> : null}
    </View>
  );
}
