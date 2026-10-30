// ui/TextField: the one text input. The field fill is a step lighter than the card in a dark skin and has a 1px edge (the --field and --field-line tokens), the placeholder is --ink-4, and a focused
// field shows the accent edge with a soft ring in place of the browser's own outline. Every sheet and form that asks for text uses this, so no field is a near-black block in a dark skin.
import { useState } from "react";
import type { ReactElement } from "react";
import { Platform, StyleSheet, TextInput } from "react-native";
import type { TextInputProps } from "react-native";

const web = Platform.OS === "web";

export function TextField({ style, onFocus, onBlur, placeholderTextColor, ...rest }: TextInputProps): ReactElement {
  const [focus, setFocus] = useState(false);
  return (
    <TextInput
      placeholderTextColor={placeholderTextColor ?? "var(--ink-4)"}
      {...rest}
      onFocus={(e) => { setFocus(true); onFocus?.(e); }}
      onBlur={(e) => { setFocus(false); onBlur?.(e); }}
      style={[s.input, style, focus && s.focus]}
    />
  );
}

const s = StyleSheet.create({
  input: { height: 36, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: "var(--field-line)" as string, backgroundColor: "var(--field)" as string, color: "var(--ink)" as string, fontSize: 13.5, ...(web ? ({ outlineStyle: "none" } as object) : null) },
  focus: { borderColor: "var(--accent)" as string, ...(web ? ({ boxShadow: "0 0 0 3px var(--accent-wash)" } as object) : null) },
});
