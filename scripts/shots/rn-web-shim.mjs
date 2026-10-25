// Node-side stand-in for `react-native`: the same names from react-native-web, as real ES exports so
// `import { View } from "react-native"` works in .tsx tests (react-native itself is Flow source and cannot load in node).
// Metro and the Expo web export never see this file; they resolve react-native to react-native-web themselves.
import { createRequire } from "node:module";
const RNW = createRequire(import.meta.url)("react-native-web");
export default RNW;
export const {
  AccessibilityInfo, ActivityIndicator, Alert, Animated, AppRegistry, AppState, Appearance, Button, Clipboard, DeviceEventEmitter, Dimensions, Easing,
  FlatList, I18nManager, Image, ImageBackground, InteractionManager, Keyboard, KeyboardAvoidingView, LayoutAnimation, Linking, Modal, NativeEventEmitter,
  NativeModules, PanResponder, PixelRatio, Platform, Pressable, RefreshControl, SafeAreaView, ScrollView, SectionList, Share, StatusBar, StyleSheet,
  Switch, Text, TextInput, Touchable, TouchableHighlight, TouchableOpacity, TouchableWithoutFeedback, UIManager, View, VirtualizedList, Vibration,
  findNodeHandle, processColor, unstable_batchedUpdates, useColorScheme, useWindowDimensions,
} = RNW;
