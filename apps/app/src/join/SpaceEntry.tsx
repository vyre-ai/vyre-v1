// Where a Space lives and how a person gets into one: join one (a link or an address), or create one. A Personal Space is on this computer; a Team Space is on this Mac or on a Linux server.
// Every step is one decision. Escape goes back, Enter submits a field, and a step that starts a server shows what is happening and why it takes a moment.
import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { Text, View } from 'react-native';
import { Bar, Button, Choice, CodeBlock, ErrorLine, Field, Foot, Group, JoinFrame, Panel, Row, Step, Title, Working, baseText, useJoin } from './kit.tsx';
import { entryTarget } from '../shell/session/entry.ts';
import type { EntryTarget } from '../shell/session/entry.ts';

export function SpaceEntry({ onTarget, onBack, onCreatePersonal, onCreateMacServer, startAt }: { onTarget(target: EntryTarget): void | Promise<void>; onBack(): void; onCreatePersonal?: () => Promise<void>; onCreateMacServer?: () => Promise<void>; startAt?: 'choice' | 'join' }): ReactElement {
  return <JoinFrame><SpaceEntryBody onTarget={onTarget} onBack={onBack} startAt={startAt ?? 'choice'} {...(onCreatePersonal ? { onCreatePersonal } : {})} {...(onCreateMacServer ? { onCreateMacServer } : {})} /></JoinFrame>;
}

/** The one command that installs a Space on a Linux server. */
export const INSTALL_COMMAND = 'curl -fsSL https://vyre.run/install.sh | sh';

type Page = 'choice' | 'join' | 'create';
type Where = 'mac' | 'linux';

function SpaceEntryBody({ onTarget, onBack, onCreatePersonal, onCreateMacServer, startAt }: { onTarget(target: EntryTarget): void | Promise<void>; onBack(): void; onCreatePersonal?: () => Promise<void>; onCreateMacServer?: () => Promise<void>; startAt: 'choice' | 'join' }): ReactElement {
  const { p } = useJoin();
  const [page, setPage] = useState<Page>(startAt);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [kind, setKind] = useState<'personal' | 'team'>('personal');
  const [where, setWhere] = useState<Where>(onCreateMacServer ? 'mac' : 'linux');
  const [busy, setBusy] = useState<null | 'target' | 'personal' | 'mac'>(null);
  const back = (): void => { if (busy) return; if (page === 'choice') onBack(); else { setPage('choice'); setValue(''); setError(''); } };
  useEffect(() => {
    const doc = (globalThis as { document?: Document }).document;
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape' && !busy) { event.preventDefault(); back(); } };
    doc?.addEventListener('keydown', onKey);
    return () => doc?.removeEventListener('keydown', onKey);
  }, [page, busy, onBack]);

  const submit = async (): Promise<void> => {
    if (busy) return;
    const target = entryTarget(value);
    if (!target) { setError(page === 'create' ? 'Paste the complete owner setup link from your server.' : 'Enter a Space address or its complete invite link.'); return; }
    if (page === 'create' && target.kind !== 'claim') { setError('Use the owner setup link printed by your new server.'); return; }
    setBusy('target'); setError('');
    try { await onTarget(target); } catch (failure) { setError(failure instanceof Error ? failure.message : 'Couldn’t open this Space. Try again.'); } finally { setBusy(null); }
  };
  const createPersonal = async (): Promise<void> => {
    if (busy || !onCreatePersonal) return;
    setBusy('personal'); setError('');
    try { await onCreatePersonal(); } catch { setError('Couldn’t start your Personal Space. Try again.'); } finally { setBusy(null); }
  };
  const runMacServer = async (): Promise<void> => {
    if (busy || !onCreateMacServer) return;
    setBusy('mac'); setError('');
    try { await onCreateMacServer(); } catch (failure) { setError(failure instanceof Error && failure.message ? failure.message : 'Couldn’t start the server on this Mac. Try again.'); } finally { setBusy(null); }
  };

  const nativePersonal = page === 'create' && kind === 'personal' && !!onCreatePersonal;
  const browserPersonal = page === 'create' && kind === 'personal' && !onCreatePersonal;
  const team = page === 'create' && kind === 'team';
  const needsLink = page === 'join' || (team && where === 'linux');
  const submitLabel = busy === 'target' ? 'Verifying…' : page === 'create' ? 'Set up my Space' : 'Continue';

  // The waiting states replace the page: nothing to press while a server starts.
  if (busy === 'personal') {
    return (
      <Panel bar={<Bar hideBack cont={null} />}>
        <Step id="space-entry-personal-starting"><Working testID="space-entry-starting" title="Creating your Personal Space" note="Vyre is starting a private server on this computer. It takes a few seconds the first time." line="Starting your Space…" /></Step>
      </Panel>
    );
  }
  if (busy === 'mac') {
    return (
      <Panel bar={<Bar hideBack cont={null} />}>
        <Step id="space-entry-mac-starting"><Working testID="space-entry-starting" title="Starting the server on this Mac" note="Your Team Space runs here while Vyre is open. This takes a few seconds." line="Starting the server…" /></Step>
      </Panel>
    );
  }

  return (
    <Panel bar={<Bar onBack={() => { if (!busy) back(); }} cont={needsLink ? <Button testID="space-entry-continue" label={submitLabel} onPress={() => void submit()} disabled={!!busy || !value.trim()} /> : null} />}>
      <Step id={`space-entry-${page}`}>
        <Title
          title={page === 'choice' ? 'Your Space' : page === 'join' ? 'Join a Space' : 'Create a Space'}
          sub={page === 'choice' ? 'Join your team, or make a place of your own.' : page === 'join' ? 'Paste an invite link, or the address of a Space you already belong to.' : 'Choose where your Space lives. Your files and work stay on that server.'}
        />

        {page === 'choice' ? (
          <View style={{ gap: 12, marginTop: 28 }}>
            <Choice testID="space-entry-join" icon="link" title="Join a Space" help="Use an invite link, or sign in to a Space you belong to." onPress={() => setPage('join')} />
            <Choice testID="space-entry-create" icon="team" title="Create a Space" help="On this computer for yourself, or on a server for your team." onPress={() => setPage('create')} />
          </View>
        ) : null}

        {page === 'create' ? (
          <>
            <Group>
              <Row kind="option" testID="space-entry-personal" title="Personal Space" help="On this computer. Private to you." checked={kind === 'personal'} onPress={() => { if (!busy) setKind('personal'); }} />
              <Row kind="option" testID="space-entry-team" title="Team Space" help="On a server your team can reach." checked={kind === 'team'} onPress={() => { if (!busy) setKind('team'); }} />
            </Group>

            {nativePersonal ? <View style={{ marginTop: 24 }}><Button large testID="create-personal-native" label="Create Personal Space" onPress={() => void createPersonal()} /></View> : null}

            {browserPersonal ? (
              <View style={{ marginTop: 8 }}>
                <Foot>Create your Personal Space in the Vyre desktop app. It runs on your computer and keeps its files there.</Foot>
                <View style={{ marginTop: 16 }}><Button quiet testID="space-personal-desktop" label="Join an existing Space" onPress={() => { setPage('join'); setValue(''); setError(''); }} /></View>
              </View>
            ) : null}

            {team ? (
              <View style={{ marginTop: 24, gap: 16 }}>
                {onCreateMacServer ? (
                  <View accessibilityRole={"radiogroup" as never} accessibilityLabel="Where the server runs" style={{ gap: 10 }}>
                    <Text style={[baseText(p), { fontSize: 13, fontWeight: '600' }]}>Where should it run?</Text>
                    <Group top={0}>
                      <Row kind="option" testID="space-where-mac" title="This Mac" help="Runs while Vyre is open. Your team reaches it through Vyre’s relay." checked={where === 'mac'} onPress={() => setWhere('mac')} />
                      <Row kind="option" testID="space-where-linux" title="A Linux server" help="Always on. One command installs it and prints your owner link." checked={where === 'linux'} onPress={() => setWhere('linux')} />
                    </Group>
                  </View>
                ) : null}
                {where === 'mac' && onCreateMacServer ? <MacServerOffer busy={false} onPress={() => void runMacServer()} /> : (
                  <View style={{ gap: 14 }}>
                    <Text style={[baseText(p), { fontSize: 13, fontWeight: '600' }]}>1. Run this on your Linux server</Text>
                    <CodeBlock testID="space-setup-command" text={INSTALL_COMMAND} />
                    <Foot top={0}>The installer verifies the release, starts your Space and prints its owner setup link.</Foot>
                  </View>
                )}
              </View>
            ) : null}
          </>
        ) : null}

        {needsLink ? (
          <View style={{ marginTop: page === 'join' ? 28 : 8 }}>
            <Field
              testID="space-entry-address" disabled={busy === 'target'} autoFocus={page === 'join'}
              label={page === 'create' ? '2. Paste the owner setup link' : 'Space address or invite link'}
              value={value} onChange={(next) => { setValue(next); setError(''); }}
              placeholder={page === 'create' ? 'https://…/claim/…' : 'https://your-space.example'} onSubmit={() => void submit()}
              {...(page === 'join' ? { hint: 'You can paste the whole invite link, or just the address.' } : {})}
            />
          </View>
        ) : null}

        {error ? <ErrorLine testID="space-entry-error">{error}</ErrorLine> : null}
      </Step>
    </Panel>
  );
}

/** The desktop app on a Mac can host the Team Space itself: it runs while Vyre is open, and people reach it through Vyre's relay. */
export function MacServerOffer({ busy, onPress }: { busy: boolean; onPress(): void }): ReactElement {
  return (
    <View>
      <Button large testID="create-mac-server" label={busy ? 'Starting the server…' : 'Run this Mac as the Space server'} disabled={busy} onPress={onPress} />
      <Foot top={12}>Your team reaches it through Vyre’s relay while Vyre is open on this Mac. For a Mac that stays on, use the Mac installer instead.</Foot>
    </View>
  );
}
