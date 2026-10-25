// Reserved sizes (ARCH 9, "No layout shift"): a thing that arrives later (an image, an avatar, the text of a message) has its box before it arrives, the size of the final content, so nothing
// below it moves when it lands. Images carry their width and height; an avatar is a fixed square; a skeleton is exactly the lines the text will take.
import { memo } from "react";
import { Image, StyleSheet, Text, View } from "react-native";

/** Body text of a message: 15 px on a 24 px line (the prototype's `.m .body`). A skeleton line and a text line are the same height. */
export const BODY_SIZE = 15;
export const BODY_LINE = 24;
/** Space after a paragraph or list. */
export const BLOCK_GAP = 10;
/** The line above a message body: avatar, name and time. */
export const AVATAR_SIZE = 20;
export const HEADER_GAP = 6;
export const HEADER_HEIGHT = AVATAR_SIZE + HEADER_GAP;

export interface ReservedImageProps {
  uri: string;
  /** The picture's own size in pixels. Its box has this ratio before the bytes arrive. */
  width: number;
  height: number;
  label: string;
  radius?: number;
  testID?: string;
}

/** A picture in a fixed box: full width up to its own width, height from the ratio. The box is painted `--sunk` until the picture arrives. */
export const ReservedImage = memo(function ReservedImage({ uri, width, height, label, radius = 8, testID }: ReservedImageProps) {
  return (
    <View testID={testID} style={[styles.imageBox, { maxWidth: width, aspectRatio: width / height, borderRadius: radius }]}>
      <Image accessibilityLabel={label} source={{ uri }} resizeMode="cover" style={styles.imageFill} />
    </View>
  );
});

export interface AvatarSlotProps {
  label: string;
  size?: number;
  /** Background of the tile. Default `--sunk`. */
  color?: string;
  testID?: string;
}

/** A square of a fixed size with the first letter in it: the same box whether or not the picture has arrived. */
export const AvatarSlot = memo(function AvatarSlot({ label, size = AVATAR_SIZE, color, testID }: AvatarSlotProps) {
  const initial = Array.from(label.trim())[0]?.toUpperCase() ?? "";
  return (
    <View testID={testID} accessibilityLabel={label} style={[styles.avatar, { width: size, height: size, borderRadius: Math.round(size * 0.3), backgroundColor: color ?? "var(--sunk)" }]}>
      <Text style={[styles.initial, { fontSize: Math.max(9, Math.round(size * 0.5)), lineHeight: size }]}>{initial}</Text>
    </View>
  );
});

/** The height a message of `lines` body lines takes (header, then the lines). What a skeleton reserves and what a one-paragraph message measures. */
export function messageHeight(lines: number, withHeader = true): number {
  return (withHeader ? HEADER_HEIGHT : 0) + Math.max(1, lines) * BODY_LINE;
}

export interface SkeletonMessageProps {
  lines?: number;
  withHeader?: boolean;
  testID?: string;
}

/** What shows while a message has not started: the header's avatar and the lines the text will fill. Same height as the message that replaces it. */
export const SkeletonMessage = memo(function SkeletonMessage({ lines = 3, withHeader = true, testID = "skeleton-message" }: SkeletonMessageProps) {
  const n = Math.max(1, lines);
  return (
    <View testID={testID} accessibilityLabel="Loading" style={{ height: messageHeight(n, withHeader) }}>
      {withHeader ? (
        <View style={styles.skelHeader}>
          <View style={[styles.skelAvatar, { width: AVATAR_SIZE, height: AVATAR_SIZE }]} />
          <View style={[styles.skelBar, { width: 88, height: 10 }]} />
        </View>
      ) : null}
      {Array.from({ length: n }, (_, i) => (
        <View key={i} style={styles.skelLine}>
          <View style={[styles.skelBar, { width: i === n - 1 && n > 1 ? "46%" : "92%", height: 10 }]} />
        </View>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  imageBox: { width: "100%", overflow: "hidden", backgroundColor: "var(--sunk)" as string },
  imageFill: { width: "100%", height: "100%" },
  avatar: { alignItems: "center", justifyContent: "center", flexShrink: 0, overflow: "hidden" },
  initial: { color: "var(--ink-2)" as string, fontWeight: "600", textAlign: "center" },
  skelHeader: { height: HEADER_HEIGHT, flexDirection: "row", alignItems: "flex-start", gap: 8 },
  skelAvatar: { borderRadius: 6, backgroundColor: "var(--sunk)" as string },
  skelLine: { height: BODY_LINE, justifyContent: "center" },
  skelBar: { borderRadius: 5, backgroundColor: "var(--sunk)" as string },
});
