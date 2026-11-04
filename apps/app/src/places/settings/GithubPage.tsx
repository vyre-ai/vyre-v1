// Settings > GitHub: the one GitHub connection a person has, which every model and feature in Vyre uses (github.me.*). Not connected: one button. Connected: the account with Disconnect, where Vyre can work
// (each org's install, with Install or Change opening GitHub's own page), what agents may do (Always, Ask me first or Never, six actions), and what has used it lately. When the Space has its own GitHub app and the
// connection was made through Vyre's, a banner asks for one reconnect.
import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import type { CapMap } from "../../../../../generated/types.ts";
import { useSettingsData } from "./data.tsx";
import { useSaved } from "./saved.tsx";
import { Choice, Glyph, Section, SettingsRow, SmallButton } from "./ui.tsx";

type Status = CapMap["github.me.status"]["out"];
type Reach = CapMap["github.me.reach"]["out"];
type Policy = CapMap["github.me.policy.get"]["out"]["policy"];
type Uses = CapMap["github.me.usage"]["out"]["uses"];
type Level = Policy["read"];

/** The six things an agent may do, in the order the page lists them, with the words a person says. */
export const GH_PERMS: readonly { key: keyof Policy; label: string; sub: string }[] = [
  { key: "read", label: "Read code", sub: "Clone, browse and search your repos" },
  { key: "push_branch", label: "Push branches", sub: "Write to branches that are not main" },
  { key: "push_default", label: "Push to main", sub: "Write straight to the main branch" },
  { key: "open_pr", label: "Open pull requests", sub: "From your branches" },
  { key: "comment", label: "Comment", sub: "On issues and pull requests" },
  { key: "merge", label: "Merge", sub: "Merge a pull request" },
];
export const GH_LEVELS: readonly { value: Level; label: string }[] = [{ value: "always", label: "Always" }, { value: "ask", label: "Ask me first" }, { value: "never", label: "Never" }];

const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? "" : "s"}`;
/** "all repos", "3 repos" or "Not installed" for one org's install. */
export function installWords(o: { install: "all" | "selected" | "none" }, repoCount: number): string {
  return o.install === "all" ? "All repos" : o.install === "selected" ? plural(repoCount, "repo") : "Not installed";
}
/** Where a use came from, in words ("pull_request.get" is a consumer id; the page shows what the person knows). */
export const consumerWords = (c: string): string => ({ crews: "Crews", ci: "CI", sessions: "Claude Code and Codex sessions", linked: "The Linked tab", "linked-tab": "The Linked tab" } as Record<string, string>)[c] ?? c;

export function GithubPage(): ReactElement {
  const data = useSettingsData();
  const saved = useSaved();
  // what the device already keeps paints at once; the reads below refresh it
  const seen = <T,>(cap: string): T | null => (data.peek?.(cap, {}) as T | undefined) ?? null;
  const [status, setStatus] = useState<Status | null>(() => seen<Status>("github.me.status"));
  const [reach, setReach] = useState<Reach | null>(() => seen<Reach>("github.me.reach"));
  const [policy, setPolicy] = useState<Policy | null>(() => seen<{ policy: Policy }>("github.me.policy.get")?.policy ?? null);
  const [uses, setUses] = useState<Uses>(() => seen<{ uses: Uses }>("github.me.usage")?.uses ?? []);
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState(false);
  const fail = useCallback((e: unknown): void => saved.failed(e instanceof Error ? e.message : "That did not work."), [saved]);
  const load = useCallback((): void => {
    void Promise.resolve(data.call("github.me.status", {})).then((o) => {
      const s = o as Status;
      setStatus(s);
      if (!s.connected) return;
      void Promise.resolve(data.call("github.me.reach", {})).then((r) => setReach(r as Reach), () => setReach(null));
      void Promise.resolve(data.call("github.me.policy.get", {})).then((r) => setPolicy((r as { policy: Policy }).policy), () => setPolicy(null));
      void Promise.resolve(data.call("github.me.usage", {})).then((r) => setUses((r as { uses: Uses }).uses), () => setUses([]));
    }, () => setStatus({ connected: false, needsReconnect: false }));
  }, [data]);
  useEffect(load, [load]);
  const connect = (): void => {
    setBusy(true);
    void Promise.resolve(data.call("github.me.connect", {})).then((o) => { data.nav.openLink?.((o as CapMap["github.me.connect"]["out"]).authUrl); setBusy(false); }, (e: unknown) => { setBusy(false); fail(e); });
  };
  const disconnect = (): void => {
    void Promise.resolve(data.call("github.me.disconnect", {})).then(() => { setSure(false); setStatus({ connected: false, needsReconnect: false }); saved.saved("GitHub disconnected"); }, fail);
  };
  const setLevel = (key: keyof Policy, v: Level): void => {
    const was = policy;
    if (was) setPolicy({ ...was, [key]: v });
    void Promise.resolve(data.call("github.me.policy.set", { policy: { [key]: v } })).then(() => saved.saved("Saved"), (e: unknown) => { if (was) setPolicy(was); fail(e); });
  };
  if (status === null) return <Section testID="github-loading">{null}</Section>;
  if (!status.connected) {
    return (
      <Section testID="github-connect">
        <SettingsRow id="github.connect" first lead={<Glyph name="link" size={18} />} label="Connect GitHub once" sub="Vyre uses it to sign you in, and agents use it for your repos."
          control={<SmallButton label={busy ? "Connecting..." : "Connect GitHub"} primary disabled={busy} testID="gh-connect" onPress={connect} />} />
      </Section>
    );
  }
  const via = status.source === "space" ? `${data.space.name}'s GitHub app` : "the Vyre GitHub app";
  return (
    <>
      {status.needsReconnect ? (
        <Section testID="github-reconnect">
          <SettingsRow id="github.reconnect" first lead={<Glyph name="link" size={16} />} label={`${data.space.name} uses its own GitHub app. Reconnect once.`} sub="Your repos and permissions stay as they are."
            control={<SmallButton label="Reconnect" primary testID="gh-reconnect" onPress={connect} />} />
        </Section>
      ) : null}
      <Section title="Account" testID="github-account">
        <SettingsRow id="github.account" first lead={<Glyph name="link" size={16} />} label={`@${status.login ?? ""}`} sub={`Signs you in to Vyre · through ${via}`}
          control={sure
            ? <><SmallButton label="Cancel" onPress={() => setSure(false)} /><SmallButton label="Disconnect" danger testID="gh-disconnect-yes" onPress={disconnect} /></>
            : <SmallButton label="Disconnect" testID="gh-disconnect" onPress={() => setSure(true)} />} />
        {sure ? <SettingsRow id="github.disconnect.sure" label="Disconnect GitHub?" sub="Agents, CI and the Linked tab stop using your repos. Your password keeps working." /> : null}
      </Section>
      <Section title="Where Vyre can work" testID="github-where">
        {reach === null || reach.orgs.length === 0
          ? <SettingsRow id="github.where.none" first label="No organisations yet" sub="Install Vyre on your account or an organisation on GitHub, then it shows here." />
          // ui-rows-lint: not a list (each line is a SettingsRow, which draws a ui/Row itself)
          : reach.orgs.map((o, i) => {
            const n = reach.repos.filter((r) => r.repo.startsWith(`${o.login}/`)).length;
            return <SettingsRow key={o.login} id={`github.org.${o.login}`} first={i === 0} lead={<Glyph name="link" size={16} />} label={o.login} sub={installWords(o, n)}
              control={o.url ? <SmallButton label={o.install === "none" ? "Install" : "Change"} testID={`gh-org-${o.login}`} onPress={() => data.nav.openLink?.(o.url as string)} /> : undefined} />;
          })}
      </Section>
      <Section title="What agents may do" testID="github-perms">
        {/* ui-rows-lint: not a list (each line is a SettingsRow, which draws a ui/Row itself) */}
        {GH_PERMS.map((p, i) => (
          <SettingsRow key={p.key} id={`github.perm.${p.key}`} first={i === 0} label={p.label} sub={p.sub}
            control={<Choice value={policy?.[p.key] ?? "ask"} options={GH_LEVELS} label={p.label} testID={`gh-perm-${p.key}`} onChange={(v) => setLevel(p.key, v as Level)} />} />
        ))}
      </Section>
      <Section title="Used by" testID="github-used">
        {uses.length === 0
          ? <SettingsRow id="github.used.none" first label="Nothing yet" sub="Crews, CI, sessions and the Linked tab show here once they use your GitHub." />
          // ui-rows-lint: not a list (each line is a SettingsRow, which draws a ui/Row itself)
          : uses.slice(0, 8).map((u, i) => <SettingsRow key={`${u.consumer}-${u.at}-${i}`} id={`github.used.${i}`} first={i === 0} label={consumerWords(u.consumer)} sub={`${u.action} · ${u.repo}`} />)}
      </Section>
    </>
  );
}
