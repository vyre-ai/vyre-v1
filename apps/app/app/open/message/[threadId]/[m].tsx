// /open/message/<threadId>/<messageId>: the address of one message (Copy Link on a message). The root layout reads it and opens the chat on that message through reach; this route only makes the
// address valid for the router and the static export.
export function generateStaticParams(): { threadId: string; m: string }[] {
  return [{ threadId: "thread", m: "message" }];
}

export default function OpenMessageRouteStub() {
  return null;
}
