// Mount for lane l-composer: the comment reply field (tasks, records, files) next to the composer's pill, empty and with a draft, regular and compact. ?v=
import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { CommentReply } from "../../../ui/src/CommentReply/index.tsx";

export const title = "Comment reply";

const draft = "Looks good to me. One thing: the retainer in section 3 still reads 2,500 and the older template said 2,800, so please check it before we send this to the client.";

export default function Mount(): ReactNode {
  return (
    <View style={{ flex: 1, backgroundColor: "var(--win)" as string, padding: 24, gap: 20, maxWidth: 480 }}>
      <Text style={{ color: "var(--ink-3)" as string, fontSize: 12 }}>Regular, empty</Text>
      <CommentReply threadId="t1" value="" placeholder="Reply" disabled={false} density="regular" />
      <Text style={{ color: "var(--ink-3)" as string, fontSize: 12 }}>Regular, with a draft</Text>
      <CommentReply threadId="t2" value={draft} placeholder="Reply" disabled={false} density="regular" />
      <Text style={{ color: "var(--ink-3)" as string, fontSize: 12 }}>Compact (phone), empty</Text>
      <CommentReply threadId="t3" value="" placeholder="Reply" disabled={false} density="compact" />
    </View>
  );
}
