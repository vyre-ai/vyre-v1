// The controls of the onboarding cards: the same button and field as every other entry screen (join/kit.tsx), for cards that draw their own rows.
export const CARD = {
  primary: { height: 44, paddingHorizontal: 18, borderRadius: 10, backgroundColor: "var(--accent)" as string, alignItems: "center", justifyContent: "center", alignSelf: "flex-start" },
  primaryText: { fontSize: 15, fontWeight: "600", color: "var(--accent-ink)" as string },
  ghost: { height: 44, paddingHorizontal: 16, borderRadius: 10, backgroundColor: "var(--field)" as string, borderWidth: 1, borderColor: "var(--field-line)" as string, alignItems: "center", justifyContent: "center" },
  ghostText: { fontSize: 14, fontWeight: "500", color: "var(--ink)" as string },
  input: { height: 44, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: "var(--field-line)" as string, backgroundColor: "var(--field)" as string, color: "var(--ink)" as string, fontSize: 15 },
  err: { fontSize: 13, lineHeight: 18, color: "var(--danger)" as string },
} as const;
