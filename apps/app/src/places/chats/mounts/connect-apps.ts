// Connect an app, one app at a time (lane r42-mcp, 19 Nov 2026): the four apps people use and "another app". Each says honestly what it takes. Cursor and Claude Code get a button or one line; Claude and ChatGPT
// only take a pasted address, so they get Copy and the two places to press. Pure: the address comes in.
import type { IconName } from "../rightpane/parts.tsx";

export type AppId = "claude" | "chatgpt" | "cursor" | "code" | "other";

export interface AppHow {
  id: AppId;
  name: string;
  /** A glyph name the sheet's Icon knows. */
  icon: IconName;
  /** What to do, in order, in plain words. */
  steps: readonly string[];
  /** The things to copy, labelled. */
  copy: ReadonlyArray<{ label: string; text: string; testID: string }>;
  /** A link that opens the app and adds Vyre with one press, when the app has one. */
  open?: { label: string; href: string };
}

export const APPS: ReadonlyArray<{ id: AppId; name: string; icon: IconName }> = [
  { id: "claude", name: "Claude", icon: "bolt" },
  { id: "chatgpt", name: "ChatGPT", icon: "chat" },
  { id: "cursor", name: "Cursor", icon: "edit" },
  { id: "code", name: "Claude Code", icon: "terminal" },
];

const b64 = (s: string): string => {
  const g = globalThis as {
    btoa?: (x: string) => string;
    Buffer?: { from(x: string): { toString(e: string): string } };
  };
  return g.btoa ? g.btoa(s) : (g.Buffer?.from(s).toString("base64") ?? "");
};

export function howTo(id: AppId, link: { url: string; claudeCode: string }): AppHow {
  const url = { label: "Address", text: link.url, testID: "connect-link" };
  switch (id) {
    case "claude":
      return {
        id,
        name: "Claude",
        icon: "bolt",
        steps: [
          "Copy the address.",
          "In Claude, open Settings, then Connectors, then Add custom connector, and paste it.",
          "Press Allow here once.",
        ],
        copy: [url],
      };
    case "chatgpt":
      return {
        id,
        name: "ChatGPT",
        icon: "chat",
        steps: [
          "Copy the address.",
          "In ChatGPT, open Settings, then Connectors, add a custom connector, and paste it.",
          "Press Allow here once.",
        ],
        copy: [url],
      };
    case "cursor":
      return {
        id,
        name: "Cursor",
        icon: "edit",
        steps: ["Press Open in Cursor.", "Press Allow here once."],
        copy: [url],
        open: {
          label: "Open in Cursor",
          href: `cursor://anysphere.cursor-deeplink/mcp/install?name=vyre&config=${encodeURIComponent(b64(JSON.stringify({ url: link.url })))}`,
        },
      };
    case "code":
      return {
        id,
        name: "Claude Code",
        icon: "terminal",
        steps: ["Paste the first line in your terminal.", "Run the second, then press Allow here once."],
        copy: [
          { label: "Add it", text: link.claudeCode, testID: "connect-claude" },
          { label: "Sign in", text: "claude mcp login vyre", testID: "connect-login" },
        ],
      };
    default:
      return {
        id: "other",
        name: "Another app",
        icon: "globe",
        steps: ["Paste the address where the app asks for an MCP server.", "Press Allow here once."],
        copy: [url],
      };
  }
}
