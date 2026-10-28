// ui/CommentReply: a comment thread ends in one full-width reply field with an up-arrow send button at the right edge (D56, spec 3.0).
// Width and the arrow are not caller choices (props.ts). Enter sends, Shift+Enter writes a new line, the arrow is disabled until there is text.
// Right-click: Paste as Plain Text, Clear. The menu ends with Report a problem, added by ui/Menu.
// Colours are skin tokens (CSS variables on web), so a skin switch repaints with no re-render.

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, TextInput, View } from "react-native";
import type { TextStyle, ViewStyle } from "react-native";
import { Glyph, ICON_UP, plainText } from "../Composer/shared.tsx";
import { menuTrigger, useMenu } from "../Menu/index.tsx";
import type { MenuEntry } from "../Menu/index.tsx";
import { COMMENT_REPLY_SEND, COMMENT_REPLY_WIDTH } from "./props.ts";
import type { CommentReplyProps } from "./props.ts";

export type { CommentReplyProps, Density } from "./props.ts";
export { COMMENT_REPLY_SEND, COMMENT_REPLY_WIDTH, frozenCommentReplyProps } from "./props.ts";

export interface CommentReplyViewProps extends CommentReplyProps {
  /** Called with the trimmed text when the arrow or Enter sends. The field clears in the same call. */
  onSend?: (text: string, threadId: string) => void;
  onChange?: (text: string, threadId: string) => void;
  testID?: string;
}

/** Heights: one line, growing to a cap. Compact (phone) is a little taller for touch. */
export function fieldHeights(density: CommentReplyProps["density"]): { min: number; max: number } {
  return density === "compact" ? { min: 40, max: 140 } : { min: 34, max: 120 };
}

export function canSendReply(text: string, disabled: boolean): boolean {
  return !disabled && text.trim().length > 0;
}

interface KeyLike {
  key: string;
  shiftKey?: boolean;
  isComposing?: boolean;
  preventDefault?: () => void;
}

const webProps = (props: Record<string, unknown>): Record<string, unknown> => (Platform.OS === "web" ? props : {});
const FIELD_STYLE = { outlineStyle: "none", outlineWidth: 0, backgroundColor: "transparent" } as unknown as TextStyle;
const RING = { boxShadow: "inset 0 0 0 1px var(--line-2)" } as unknown as ViewStyle;
const RING_FOCUS = { boxShadow: "inset 0 0 0 1px var(--accent-line), 0 0 0 3px var(--accent-wash)" } as unknown as ViewStyle;

export function CommentReply(props: CommentReplyViewProps): ReactElement {
  const { min, max } = fieldHeights(props.density);
  const [text, setText] = useState(props.value);
  const [height, setHeight] = useState(min);
  const [focused, setFocused] = useState(false);
  const textRef = useRef(text);
  textRef.current = text;
  const menu = useMenu();

  useEffect(() => {
    if (props.value !== textRef.current) setText(props.value);
  }, [props.value]);

  const ok = canSendReply(text, props.disabled);

  const send = useCallback(() => {
    const value = textRef.current.trim();
    if (value.length === 0 || props.disabled) return;
    textRef.current = "";
    setText("");
    setHeight(min);
    props.onSend?.(value, props.threadId);
  }, [props.disabled, props.onSend, props.threadId, min]);

  const change = (value: string): void => {
    setText(value);
    props.onChange?.(value, props.threadId);
  };

  const onKeyPress = (event: { nativeEvent: KeyLike; preventDefault?: () => void }): void => {
    const k = event.nativeEvent;
    if (k.key !== "Enter" || k.shiftKey === true || k.isComposing === true) return;
    event.preventDefault?.();
    k.preventDefault?.();
    send();
  };

  const items = (): MenuEntry[] => [
    {
      label: "Paste as Plain Text",
      icon: "copy",
      onSelect: () => {
        const clip = (globalThis as { navigator?: { clipboard?: { readText?: () => Promise<string> } } }).navigator?.clipboard;
        void clip?.readText?.().then((raw) => change(textRef.current + plainText(raw)));
      },
    },
    { label: "Clear", icon: "trash", danger: true, onSelect: () => change("") },
  ];
  const contextProps = menuTrigger((x, y) => menu.show(items(), x, y, "context", { label: "Reply field" }));
  const label = props.placeholder.length > 0 ? props.placeholder : "Reply";

  return (
    <View
      style={[styles.box, props.density === "compact" && styles.boxCompact, focused ? RING_FOCUS : RING]}
      testID={props.testID ?? `comment-reply-${props.threadId}`}
      {...webProps({ dataSet: { width: COMMENT_REPLY_WIDTH, send: COMMENT_REPLY_SEND } })}
      {...contextProps}
    >
      <TextInput
        multiline
        editable={!props.disabled}
        value={text}
        onChangeText={change}
        onKeyPress={onKeyPress as never}
        onContentSizeChange={(e) => setHeight(Math.max(min, Math.min(max, Math.ceil(e.nativeEvent.contentSize.height) + 12)))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={props.placeholder}
        placeholderTextColor="var(--ink-4)"
        accessibilityLabel={label}
        testID="comment-reply-field"
        style={[styles.field, FIELD_STYLE, { height }]}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Send reply"
        accessibilityState={{ disabled: !ok }}
        disabled={!ok}
        onPress={send}
        testID="comment-reply-send"
        {...webProps({ title: "Send reply" })}
        style={[styles.send, !ok && styles.sendOff]}
      >
        <Glyph icon={ICON_UP} native={"↑"} size={15} color="var(--accent-ink)" />
      </Pressable>
      {menu.element}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { width: "100%", flexDirection: "row", alignItems: "flex-end", borderRadius: 10, backgroundColor: "var(--raised)" as string, paddingLeft: 10, paddingRight: 6, paddingVertical: 4 },
  boxCompact: { borderRadius: 12, paddingLeft: 12, paddingVertical: 5 },
  field: { flex: 1, minWidth: 0, color: "var(--ink)" as string, fontSize: 13, lineHeight: 19, paddingVertical: 6, paddingHorizontal: 0, margin: 0, borderWidth: 0 },
  send: { width: 26, height: 26, borderRadius: 13, marginBottom: 4, marginLeft: 6, alignItems: "center", justifyContent: "center", backgroundColor: "var(--accent)" as string },
  sendOff: { opacity: 0.35 },
});
