// The Assistant's cards, drawn from the models in model.ts (design Part 4A, 4E, 4F). Each takes its card as data and reports one answer; the screen around it (Ask Vyre, the sheet, the Vault's dialog) decides what the answer does.
// The credential card is one component. The value he types goes to `port.save`, which writes it to the Vault; it is never in an event or a line the card draws.
import { useState } from "react";
import type { ReactElement } from "react";
import { Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { AppLogo } from "../../../../../../ui/src/AppLogo/index.tsx";
import { CRED_START, credentialStep, credentialView } from "./model.ts";
import type {
  AppRef,
  CredEvent,
  Credential,
  FormChoiceCard,
  TrailGroup,
  allowCard,
  askAdminCard,
  mappingCard,
  testLeadCard,
  understoodCard,
  waitingCard,
} from "./model.ts";

function CardAction({
  id,
  label,
  primary,
  onPress,
}: {
  id: string;
  label: string;
  primary?: boolean;
  onPress(): void;
}): ReactElement {
  return (
    <Pressable testID={id} accessibilityRole="button" onPress={onPress} style={[s.btn, primary ? s.primary : null]}>
      <Text style={[s.btnText, primary ? s.primaryText : null]}>{label}</Text>
    </Pressable>
  );
}

function Head({ app, title }: { app: AppRef | null; title: string }): ReactElement {
  return (
    <View style={s.head}>
      {app ? <AppLogo app={app.id} name={app.name} size={24} /> : null}
      <Text style={s.title}>{title}</Text>
    </View>
  );
}

export interface VaultPort {
  /** Writes the value to the Vault under the app's name. Resolves saved, or refused when the app did not accept it. The value goes nowhere else. */
  save(value: string): Promise<"saved" | "refused">;
}

export function CredentialCard(p: {
  credential: Credential;
  port: VaultPort;
  onClose(): void;
  onBrowser?(): void;
  onSignIn?(): void;
}): ReactElement {
  const [st, setSt] = useState(CRED_START);
  const send = (e: CredEvent): void => {
    const r = credentialStep(p.credential, st, e);
    setSt(r.state);
    if (r.effect?.kind === "save")
      void p.port
        .save(r.effect.value)
        .then((res) => setSt((cur) => credentialStep(p.credential, cur, { type: res }).state));
    else if (r.effect?.kind === "close") p.onClose();
    else if (r.effect?.kind === "open_browser") p.onBrowser?.();
  };
  const v = credentialView(p.credential, st);
  if (v.doneLine)
    return (
      <View style={s.card}>
        <Text style={s.quiet}>{v.doneLine}</Text>
      </View>
    );
  return (
    <View style={s.card}>
      <Head app={p.credential.app} title={v.title ?? ""} />
      {v.field ? (
        <TextInput
          testID="cc-field"
          value={st.value}
          onChangeText={(value) => send({ type: "input", value })}
          secureTextEntry
          autoComplete="off"
          placeholder={v.field.label}
          placeholderTextColor="var(--ink-3)"
          accessibilityLabel={v.field.label}
          style={s.input}
        />
      ) : null}
      {v.refusedLine ? <Text style={s.warn}>{v.refusedLine}</Text> : null}
      <Text style={s.quiet}>{v.savedLine}</Text>
      <View style={s.actions}>
        {p.credential.mode === "signin" ? (
          <CardAction id="cc-signin" label={v.actions[0]!} primary onPress={() => p.onSignIn?.()} />
        ) : (
          <>
            <CardAction id="cc-save" label="Save" primary onPress={() => send({ type: "save" })} />
            <CardAction id="cc-how" label={v.actions[1]!} onPress={() => send({ type: "how" })} />
            <CardAction id="cc-stuck" label="I am stuck" onPress={() => send({ type: "stuck" })} />
          </>
        )}
        <CardAction id="cc-close" label="Close" onPress={() => send({ type: "close" })} />
      </View>
      {v.confirmClose ? (
        <View style={s.stuck}>
          <Text style={s.title}>{v.confirmClose}</Text>
          <View style={s.actions}>
            <CardAction id="cc-keep" label="Keep" primary onPress={() => send({ type: "keep" })} />
            <CardAction id="cc-discard" label="Discard" onPress={() => send({ type: "discard" })} />
          </View>
        </View>
      ) : null}
      {v.how ? (
        "steps" in v.how ? (
          <View>
            <Text style={s.quiet}>{v.how.source}</Text>
            {/* ui-rows-lint: not a list (numbered steps of one card) */}
            {v.how.steps.map((t, i) => (
              <Text key={i} style={s.step}>{`${i + 1}. ${t}`}</Text>
            ))}
          </View>
        ) : (
          <Text style={s.quiet}>{v.how.finding}</Text>
        )
      ) : null}
      {v.stuck ? (
        "done" in v.stuck ? (
          <Text style={s.quiet}>{v.stuck.done}</Text>
        ) : (
          <View style={s.stuck}>
            <Text style={s.title}>{v.stuck.title}</Text>
            <Text style={s.quiet}>{v.stuck.note}</Text>
            <CardAction
              id={st.stuck === 1 ? "cc-browser" : "cc-signed"}
              label={v.stuck.action}
              primary
              onPress={() => send({ type: st.stuck === 1 ? "browser" : "signed_in" })}
            />
          </View>
        )
      ) : null}
    </View>
  );
}

export function UnderstoodCard(p: {
  card: ReturnType<typeof understoodCard>;
  onAnswer(a: "yes" | "change"): void;
}): ReactElement {
  return (
    <View style={s.card}>
      <Text style={s.title}>{p.card.title}</Text>
      <View style={s.line}>
        <AppLogo app={p.card.trigger.app.id} name={p.card.trigger.app.name} size={20} />
        <Text style={s.body}>{p.card.trigger.text}</Text>
      </View>
      {/* ui-rows-lint: not a list (the lines of one card) */}
      {p.card.items.map((i) => (
        <View key={i.n} style={s.line}>
          {i.app ? <AppLogo app={i.app.id} name={i.app.name} size={20} /> : null}
          <Text style={s.body}>{i.text}</Text>
        </View>
      ))}
      {p.card.split ? <Text style={s.warn}>{p.card.split.title}</Text> : null}
      <View style={s.actions}>
        <CardAction id="uc-yes" label={p.card.actions[0]!} primary onPress={() => p.onAnswer("yes")} />
        <CardAction id="uc-change" label={p.card.actions[1]!} onPress={() => p.onAnswer("change")} />
      </View>
    </View>
  );
}

export function MappingCard(p: { card: ReturnType<typeof mappingCard>; onChoose(id: string): void }): ReactElement {
  return (
    <View style={s.card}>
      <Head app={p.card.app} title={p.card.title} />
      {/* ui-rows-lint: not a list (the lines of one card) */}
      {p.card.rows.map((r) => (
        <View key={r.from} style={s.line}>
          <Text style={s.body}>{`${r.from}  →  ${r.to ?? "no match"}`}</Text>
        </View>
      ))}
      {p.card.line ? <Text style={s.warn}>{p.card.line}</Text> : null}
      <View style={s.actions}>
        {/* ui-rows-lint: not a list (the buttons of one card) */}
        {p.card.choices.map((c, i) => (
          <CardAction key={c.id} id={`mc-${c.id}`} label={c.label} primary={i === 0} onPress={() => p.onChoose(c.id)} />
        ))}
      </View>
    </View>
  );
}

export function WaitingCard(p: { card: ReturnType<typeof waitingCard>; onCheck(): void }): ReactElement {
  return (
    <View style={s.card}>
      <Head app={p.card.app} title={p.card.title} />
      <Text selectable style={s.mono}>
        {p.card.url}
      </Text>
      <Text style={s.quiet}>{p.card.note}</Text>
      <View style={s.actions}>
        <CardAction id="wc-check" label={p.card.actions[0]!} onPress={p.onCheck} />
      </View>
    </View>
  );
}

export function TestLeadCard(p: {
  card: ReturnType<typeof testLeadCard>;
  onAnswer(a: "run" | "skip"): void;
}): ReactElement {
  return (
    <View style={s.card}>
      <Head app={p.card.app} title={p.card.title} />
      <Text style={s.body}>{p.card.line}</Text>
      <View style={s.actions}>
        <CardAction id="tl-create" label={p.card.actions[0]!} primary onPress={() => p.onAnswer("run")} />
        <CardAction id="tl-skip" label={p.card.actions[1]!} onPress={() => p.onAnswer("skip")} />
      </View>
    </View>
  );
}

export function AllowCard(p: {
  card: Pick<ReturnType<typeof allowCard>, "title" | "line" | "actions">;
  onAnswer(a: "yes" | "no"): void;
}): ReactElement {
  return (
    <View style={s.card}>
      <Text style={s.title}>{p.card.title}</Text>
      <Text style={s.quiet}>{p.card.line}</Text>
      <View style={s.actions}>
        <CardAction id="al-allow" label={p.card.actions[0]!} primary onPress={() => p.onAnswer("yes")} />
        <CardAction id="al-no" label={p.card.actions[1]!} onPress={() => p.onAnswer("no")} />
      </View>
    </View>
  );
}

export function TrailCard(p: { groups: readonly TrailGroup[] }): ReactElement {
  return (
    <View style={s.trail}>
      {/* ui-rows-lint: not a list (the ticked lines of one trail) */}
      {p.groups.map((g, gi) => (
        <View key={g.app?.id ?? "general"} style={s.trail}>
          {g.app ? (
            <View style={s.line}>
              <AppLogo app={g.app.id} name={g.app.name} size={20} />
              <Text style={s.title}>{g.app.name}</Text>
            </View>
          ) : null}
          {/* ui-rows-lint: not a list (the ticked lines of one app) */}
          {g.lines.map((l, li) => (
            <Text
              key={li}
              testID={`tr-${l.state}-${gi}-${li}`}
              style={s.quiet}
            >{`${l.state === "done" ? "\u2713" : "\u2026"} ${l.text}`}</Text>
          ))}
        </View>
      ))}
    </View>
  );
}

export function FormChoiceView(p: { card: FormChoiceCard; onPick(id: string): void; onNeither(): void }): ReactElement {
  return (
    <View style={s.card}>
      <Text style={s.title}>{p.card.title}</Text>
      <View style={s.actions}>
        {/* ui-rows-lint: not a list (the choices of one card) */}
        {p.card.choices.map((c) => (
          <Pressable
            key={c.id}
            testID={`fc-${c.id}`}
            accessibilityRole="button"
            onPress={() => p.onPick(c.id)}
            style={s.formChoice}
          >
            {c.picture ? (
              <Image
                testID={`fc-picture-${c.id}`}
                source={{ uri: c.picture }}
                accessibilityLabel={`${c.label} form`}
                style={s.picture}
                resizeMode="cover"
              />
            ) : null}
            <Text style={s.title}>{c.label}</Text>
            {c.line ? <Text style={s.quiet}>{c.line}</Text> : null}
          </Pressable>
        ))}
      </View>
      {p.card.actions.length > 0 ? (
        <View style={s.actions}>
          <CardAction id="fc-neither" label={p.card.actions[0]!} onPress={p.onNeither} />
        </View>
      ) : null}
    </View>
  );
}

export function AskAdminCard(p: {
  card: Pick<ReturnType<typeof askAdminCard>, "title" | "line" | "actions">;
  asked: boolean;
  onAsk(): void;
}): ReactElement {
  if (p.asked)
    return (
      <View style={s.card}>
        <Text style={s.quiet}>{`Asked ${p.card.actions[0]!.replace(/^Ask /, "")}. It is in their Needs you.`}</Text>
      </View>
    );
  return (
    <View style={s.card}>
      <Text style={s.title}>{p.card.title}</Text>
      <Text style={s.quiet}>{p.card.line}</Text>
      <View style={s.actions}>
        <CardAction id="aa-ask" label={p.card.actions[0]!} primary onPress={p.onAsk} />
      </View>
    </View>
  );
}

/** The one open Needs you line of a build he left midway: it names the thing and Continue reopens that card where it stopped. */
export function ResumeNeed(p: {
  need: { id: string; text: string; app: AppRef };
  onContinue(id: string): void;
}): ReactElement {
  return (
    <View style={[s.card, s.line]}>
      <AppLogo app={p.need.app.id} name={p.need.app.name} size={24} />
      <Text style={[s.body, { flex: 1 }]}>{p.need.text}</Text>
      <CardAction id="rn-continue" label="Continue" primary onPress={() => p.onContinue(p.need.id)} />
    </View>
  );
}

const s = StyleSheet.create({
  trail: { gap: 4 },
  formChoice: { width: 150, gap: 4, padding: 8, borderRadius: 12, backgroundColor: "var(--sunk)" as string },
  picture: { width: "100%", height: 70, borderRadius: 8 },
  card: {
    gap: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "var(--raised)" as string,
    borderWidth: 1,
    borderColor: "var(--line)" as string,
  },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 13, fontWeight: "600", color: "var(--ink)" as string },
  body: { fontSize: 13, lineHeight: 18, color: "var(--ink)" as string, flexShrink: 1 },
  quiet: { fontSize: 12, lineHeight: 16, color: "var(--ink-3)" as string },
  warn: { fontSize: 12.5, color: "var(--warn)" as string },
  line: { flexDirection: "row", alignItems: "center", gap: 8 },
  step: { fontSize: 12.5, lineHeight: 18, color: "var(--ink-2)" as string },
  mono: { fontSize: 12, color: "var(--ink-2)" as string, fontFamily: "var(--mono)" as string },
  input: {
    height: 34,
    paddingHorizontal: 10,
    fontSize: 13,
    color: "var(--ink)" as string,
    borderRadius: 10,
    backgroundColor: "var(--sunk)" as string,
  },
  actions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  stuck: { gap: 6, padding: 10, borderRadius: 10, backgroundColor: "var(--sunk)" as string },
  btn: {
    height: 28,
    paddingHorizontal: 12,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "var(--hover)" as string,
  },
  btnText: { fontSize: 12.5, color: "var(--ink)" as string },
  primary: { backgroundColor: "var(--accent)" as string },
  primaryText: { color: "var(--accent-ink)" as string },
});
