// The connection screen is deliberately small: a person names a real Space, then the caller verifies it before credentials appear.
import { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { ErrorLine, useJoin } from "./kit.tsx";
import { FONT } from "./palette.ts";
import { normalizeSpaceAddress, welcomeGreeting } from "./logic.ts";

export interface WelcomeProps {
  address: string;
  busy: boolean;
  error: string;
  onAddressChange: (value: string) => void;
  onSignIn: () => void;
  onGetStarted: () => void;
}

export function Welcome({ address, busy, error, onAddressChange, onSignIn, onGetStarted }: WelcomeProps) {
  const valid = !!normalizeSpaceAddress(address);
  // Static exports can be opened in another time zone or after midnight. The
  // first browser render must match the exported markup before using its clock.
  const [greeting, setGreeting] = useState("Welcome back");
  useEffect(() => { setGreeting(welcomeGreeting(new Date().getHours())); }, []);
  const { p, phone } = useJoin();
  const disabled = !valid || busy;
  const go = () => { if (!disabled) onSignIn(); };
  return (
    <ScrollView testID="welcome-hero" style={{ width: "100%", flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 24, paddingVertical: 64 }}>
      <View testID="step-welcome" style={{ width: "100%", maxWidth: 720, alignItems: "center" }}>
        <View style={{ alignItems: "center", gap: 6, marginBottom: 28 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Image source={{ uri: "/vyre-mark.svg" }} accessible={false} style={{ width: 28, height: 28 }} />
            <Text style={{ fontFamily: FONT, color: p.tx, fontSize: 15, fontWeight: "600" }}>Vyre</Text>
          </View>
          <Text style={{ fontFamily: FONT, color: p.tx2, fontSize: 12.5 }}>The command center for AI-native teams</Text>
        </View>
        <Text accessibilityRole="header" style={{ fontFamily: FONT, color: p.tx, fontSize: phone ? 40 : 64, lineHeight: phone ? 46 : 72, fontWeight: "700", letterSpacing: phone ? -1.4 : -2.4, textAlign: "center" }}>{greeting}.</Text>
        <Text style={{ fontFamily: FONT, color: p.tx2, fontSize: phone ? 16 : 18, lineHeight: 26, marginTop: 14, textAlign: "center" }}>Welcome back. Connect a Space and make yourself at home.</Text>
        <View style={{ flexDirection: "row", alignItems: "center", marginTop: 32, height: 54, width: "100%", maxWidth: 440, paddingLeft: 18, paddingRight: 5, borderRadius: 999, backgroundColor: p.panel, borderWidth: 1, borderColor: p.hair }}>
          {!phone ? <Text style={{ fontFamily: FONT, color: p.tx2, fontSize: 14, marginRight: 10 }}>Sign in to</Text> : null}
          <TextInput testID="space-address" accessibilityLabel="Space address" value={address} onChangeText={onAddressChange} onSubmitEditing={go} placeholder="your-space.example" placeholderTextColor={p.tx2} autoComplete="url" autoCapitalize="none" autoCorrect={false} returnKeyType="go" style={{ flex: 1, minWidth: 0, fontFamily: FONT, color: p.tx, fontSize: 16, paddingVertical: 0 }} />
          <Pressable testID="resolve-space" accessibilityRole="button" accessibilityLabel={busy ? "Verifying Space" : "Sign in"} accessibilityState={{ disabled, busy }} disabled={disabled} onPress={go} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: p.tx, opacity: disabled ? 0.4 : 1, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: p.panel, fontSize: 23 }}>{busy ? "…" : "→"}</Text>
          </Pressable>
        </View>
        {error ? <ErrorLine testID="space-error">{error}</ErrorLine> : null}
        <Pressable testID="get-started" accessibilityRole="button" disabled={disabled} onPress={onGetStarted} style={{ minHeight: 44, paddingHorizontal: 22, marginTop: 20, borderRadius: 999, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: p.hair, backgroundColor: p.panel, opacity: disabled ? 0.4 : 1 }}>
          <Text style={{ fontFamily: FONT, color: p.tx, fontSize: 14, fontWeight: "500" }}>New here? Get started</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
