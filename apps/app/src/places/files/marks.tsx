// What a file or folder from a connected folder looks like in Files (live folders): a Google Doc, Sheet, Slides deck, Drawing or Form carries its app's tile, and anything else that
// comes from a provider carries the provider's mark (Google Drive, OneDrive, SharePoint, Dropbox, GitHub) on the corner of its own icon. The row, the grid tile, the tree and the
// viewer's header read the same few functions, so a Drive file looks the same wherever it is.
import type { ReactElement, ReactNode } from "react";
import { View } from "react-native";
import { AppIcon } from "../../../../../ui/src/AppIcon/index.tsx";
import { Mark } from "./mounts/icons.tsx";
import { GOOGLE_APP_NAME, googleAppOf, providerMarkOf } from "./google.ts";
import type { GoogleApp } from "./google.ts";

export { GOOGLE_APP_NAME, GOOGLE_KIND_WORD, googleAppOf, providerMarkOf } from "./google.ts";
export type { GoogleApp } from "./google.ts";

/** A Google app's own tile, the size of a row's type tile. */
export function GoogleTile({ app, size = 30 }: { app: GoogleApp; size?: number }): ReactElement {
  return <View testID={`google-tile-${app}`} accessibilityLabel={GOOGLE_APP_NAME[app]}><AppIcon brand={app} size={size} name={GOOGLE_APP_NAME[app]} testID={`appicon-${app}`} /></View>;
}

/** An icon with the provider's mark on its lower right corner. */
export function WithProviderMark({ provider, size = 12, children }: { provider: string | null | undefined; size?: number; children: ReactNode }): ReactElement {
  const mark = providerMarkOf(provider);
  if (mark === null) return <>{children}</>;
  return (
    <View style={{ position: "relative" }} testID={`provider-marked-${mark}`} accessibilityLabel={`From ${provider ?? ""}`}>
      {children}
      <View pointerEvents="none" style={{ position: "absolute", right: -4, bottom: -4, borderRadius: 4, backgroundColor: "var(--win)" as string }}><Mark kind={mark} size={size} /></View>
    </View>
  );
}

/**
 * The leading icon of a file or folder line: a Google app's tile for a Google-native file, else the line's own icon with the provider's mark when it comes from a connected folder.
 * `base` is the icon the line would have without a provider.
 */
export function SourcedLead({ line, base, size = 30, gap = 0 }: { line: { type: "file" | "folder"; kind: string; mime?: string | undefined; source: string | null }; base: ReactElement; size?: number; /** space after a Google tile, as the type tile keeps after itself */ gap?: number }): ReactElement {
  const app = line.type === "file" ? googleAppOf(line) : null;
  if (app !== null) return <View style={{ marginRight: gap, flexShrink: 0 }}><GoogleTile app={app} size={size} /></View>;
  return <WithProviderMark provider={line.source}>{base}</WithProviderMark>;
}
