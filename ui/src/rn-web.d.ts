// react-native-web gives Pressable's state callback a `hovered` flag, and its TextInput and ScrollView refs `focus`, `scrollTo` and `scrollToEnd`; react-native's own types do not say so.
// Said once here so the typecheck reads what the web build does (see scripts/typecheck-ratchet.ts).
import "react-native";
declare module "react-native" {
  interface PressableStateCallbackType { readonly hovered?: boolean }
}
