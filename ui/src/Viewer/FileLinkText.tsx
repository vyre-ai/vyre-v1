// A file reference drawn as a quiet link (rc.8): the label in the accent, a dotted underline, the path on hover; a click opens the file in a tab, Cmd-click or middle click opens it in the background.
// A reference to a file that is not there is dim, and its hover says Create it. Anything else is plain words.
import { createElement } from "react";
import type { ReactElement } from "react";
import { Platform, StyleSheet, Text } from "react-native";
import { Tooltip } from "../Tooltip/index.tsx";
import { linkState } from "./links.ts";
import type { FileLinks, FileRef } from "./links.ts";

interface ClickLike { metaKey?: boolean; ctrlKey?: boolean; button?: number; preventDefault?: () => void; stopPropagation?: () => void; key?: string }

export function FileLinkText({ r, links }: { r: FileRef; links: FileLinks | undefined }): ReactElement {
  const state = linkState(r, links);
  if (state === "plain" || !links) return <Text>{r.label}</Text>;
  const t = links.targets.get(r.ref);
  if (state === "link" && t) {
    const open = (bg: boolean): void => links.open(t, bg);
    const web = Platform.OS === "web"
      ? ({
        role: "link", tabIndex: 0, "data-filelink": t.id,
        onClick: (e: ClickLike) => { e.preventDefault?.(); open(e.metaKey === true || e.ctrlKey === true); },
        onAuxClick: (e: ClickLike) => { if (e.button === 1) { e.preventDefault?.(); open(true); } },
        onKeyDown: (e: ClickLike) => { if (e.key === "Enter") { e.preventDefault?.(); open(false); } },
      } as object)
      : {};
    return <Tooltip text={t.path ?? t.name}><Text testID={`filelink-${t.id}`} accessibilityRole="link" accessibilityLabel={`Open ${t.name}`} onPress={() => open(false)} style={s.link} {...web}>{r.label}</Text></Tooltip>;
  }
  const create = links.create;
  const web = Platform.OS === "web" && create ? ({ role: "link", tabIndex: 0, onClick: (e: ClickLike) => { e.preventDefault?.(); create(r.ref); } } as object) : {};
  return <Tooltip text={create ? "Create it" : "Not here"}><Text testID={`filelink-missing-${r.ref}`} accessibilityRole={create ? "link" : "text"} accessibilityLabel={`${r.label}, not here`} {...(create ? { onPress: () => create(r.ref) } : {})} style={s.broken} {...web}>{r.label}</Text></Tooltip>;
}

/** The words of a run of text with its file references drawn as links. */
export function withFileLinks(parts: ReadonlyArray<string | FileRef>, links: FileLinks | undefined): ReactElement[] {
  return parts.map((p, i) => (typeof p === "string" ? createElement(Text, { key: i }, p) : <FileLinkText key={i} r={p} links={links} />));
}

const s = StyleSheet.create({
  link: { color: "var(--accent)" as string, textDecorationLine: "underline", textDecorationStyle: "dotted", textDecorationColor: "var(--accent-line)" as string, cursor: "pointer" } as object,
  broken: { color: "var(--ink-4)" as string, textDecorationLine: "underline", textDecorationStyle: "dashed", textDecorationColor: "var(--line-2)" as string } as object,
});
