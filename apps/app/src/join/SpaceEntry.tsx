// Where a Space lives and how a person gets into one: join one (a link or an address), or create one. A Personal Space is on this computer; a Team Space is on this Mac or on a Linux server.
// Every step is one decision. Escape goes back, Enter submits a field, and a step that starts a server shows what is happening and why it takes a moment.
import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { Text, View } from 'react-native';
import { Bar, Button, Choice, CodeBlock, Door, ErrorLine, Field, Foot, JoinFrame, Panel, Step, Title, Working, baseText, useJoin } from './kit.tsx';
import { Art } from './art.tsx';
import { entryTarget } from '../shell/session/entry.ts';
import type { EntryTarget } from '../shell/session/entry.ts';

export function SpaceEntry({ onTarget, onBack, onCreatePersonal, onCreateMacServer, startAt }: { onTarget(target: EntryTarget): void | Promise<void>; onBack(): void; onCreatePersonal?: () => Promise<void>; onCreateMacServer?: () => Promise<void>; startAt?: 'choice' | 'join' | 'team' }): ReactElement {
  return <JoinFrame><SpaceEntryBody onTarget={onTarget} onBack={onBack} startAt={startAt ?? 'choice'} {...(onCreatePersonal ? { onCreatePersonal } : {})} {...(onCreateMacServer ? { onCreateMacServer } : {})} /></JoinFrame>;
}

/** The one command that installs a Space on a Linux server. */
export const INSTALL_COMMAND = 'curl -fsSL https://vyre.run/install.sh | sh';

type Page = 'choice' | 'join' | 'create';
type Where = 'mac' | 'linux';

function SpaceEntryBody({ onTarget, onBack, onCreatePersonal, onCreateMacServer, startAt }: { onTarget(target: EntryTarget): void | Promise<void>; onBack(): void; onCreatePersonal?: () => Promise<void>; onCreateMacServer?: () => Promise<void>; startAt: 'choice' | 'join' | 'team' }): ReactElement {
  const { p } = useJoin();
  const [page, setPage] = useState<Page>(startAt === 'team' ? 'create' : startAt);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  // create: first what (a Personal Space on this computer, or a Team Space), then for a team where it runs. A team set up from the first screen starts at the team.
  const [kind, setKind] = useState<null | 'personal' | 'team'>(startAt === 'team' ? 'team' : null);
  const [where, setWhere] = useState<null | Where>(startAt === 'team' && !onCreateMacServer ? 'linux' : null);
  const [busy, setBusy] = useState<null | 'target' | 'personal' | 'mac'>(null);
  const back = (): void => {
    if (busy) return;
    setError('');
    if (page === 'create' && where !== null && onCreateMacServer) { setWhere(null); setValue(''); return; }
    if (page === 'create' && kind !== null && startAt !== 'team') { setKind(null); setWhere(null); setValue(''); return; }
    if (page === 'choice' || startAt === 'team' || startAt === 'join') { onBack(); return; }
    setPage('choice'); setValue(''); setKind(null); setWhere(null);
  };
  useEffect(() => {
    const doc = (globalThis as { document?: Document }).document;
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape' && !busy) { event.preventDefault(); back(); } };
    doc?.addEventListener('keydown', onKey);
    return () => doc?.removeEventListener('keydown', onKey);
  }, [page, busy, onBack, kind, where]);

  const submit = async (): Promise<void> => {
    if (busy) return;
    const target = entryTarget(value);
    if (!target) { setError(page === 'create' ? 'Paste the owner link from your server.' : 'That is not an invite link or a Space address.'); return; }
    if (page === 'create' && target.kind !== 'claim') { setError('Paste the owner link your server printed.'); return; }
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
    try { await onCreateMacServer(); } catch (failure) { setError(failure instanceof Error && failure.message ? failure.message : 'Couldn’t start the server on this Mac. Try again.'); setWhere(null); } finally { setBusy(null); }
  };

  const needsLink = page === 'join' || (page === 'create' && kind === 'team' && where === 'linux');
  const submitLabel = busy === 'target' ? 'Verifying…' : page === 'create' ? 'Continue' : 'Continue';

  // The waiting states replace the page: nothing to press while a server starts.
  if (busy === 'personal') return <Panel bar={<Bar hideBack cont={null} />}><Step id="space-entry-personal-starting"><Working testID="space-entry-starting" title="Creating your Space" line="Starting your Space…" /></Step></Panel>;
  if (busy === 'mac') return <Panel bar={<Bar hideBack cont={null} />}><Step id="space-entry-mac-starting"><Working testID="space-entry-starting" title="Starting the server" line="Starting the server on this Mac…" /></Step></Panel>;

  const title = page === 'choice' ? 'Your Space' : page === 'join' ? 'Join your team' : kind === null ? 'Create a Space' : kind === 'personal' ? 'Personal Space' : where === 'linux' ? 'Run this on your server' : 'Where does it run?';
  return (
    <Panel bar={<Bar onBack={() => { if (!busy) back(); }} cont={needsLink ? <Button testID="space-entry-continue" label={submitLabel} onPress={() => void submit()} disabled={!!busy || !value.trim()} /> : null} />}>
      <Step id={`space-entry-${page}`}>
        <Title title={title} />

        {page === 'choice' ? (
          <View style={{ gap: 12, marginTop: 28 }}>
            <Choice testID="space-entry-join" icon="link" title="Join a Space" help="An invite link or a Space address" onPress={() => setPage('join')} />
            <Choice testID="space-entry-create" icon="team" title="Create a Space" help="Personal, or for a team" onPress={() => setPage('create')} />
          </View>
        ) : null}

        {page === 'create' && kind === null ? (
          <View style={{ flexDirection: 'row', gap: 16, marginTop: 28, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Door testID="space-entry-personal" art={<Art kind="me" />} title="Personal" hint="On this computer" onPress={() => setKind('personal')} />
            <Door testID="space-entry-team" art={<Art kind="team" />} title="Team" hint="On a server" onPress={() => { setKind('team'); if (!onCreateMacServer) setWhere('linux'); }} />
          </View>
        ) : null}

        {page === 'create' && kind === 'personal' ? (
          onCreatePersonal
            ? <View style={{ marginTop: 28 }}><Button large testID="create-personal-native" label="Create Personal Space" onPress={() => void createPersonal()} /></View>
            : <View style={{ marginTop: 24, gap: 14 }}><Foot>A Personal Space needs the desktop app.</Foot><Button quiet testID="space-personal-desktop" label="Join an existing Space" onPress={() => { setPage('join'); setKind(null); setValue(''); setError(''); }} /></View>
        ) : null}

        {page === 'create' && kind === 'team' && where === null ? (
          <View style={{ flexDirection: 'row', gap: 16, marginTop: 28, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Door testID="space-where-mac" art={<Art kind="mac" />} title="This Mac" hint="While Vyre is open" onPress={() => { setWhere('mac'); void runMacServer(); }} />
            <Door testID="space-where-linux" art={<Art kind="server" />} title="A Linux server" hint="Always on" onPress={() => setWhere('linux')} />
          </View>
        ) : null}

        {page === 'create' && kind === 'team' && where === 'linux' ? (
          <View style={{ marginTop: 24, gap: 14 }}>
            <CodeBlock testID="space-setup-command" text={INSTALL_COMMAND} />
            <Text style={[baseText(p), { fontSize: 13, fontWeight: '600', marginTop: 6 }]}>Then paste the owner link it prints</Text>
          </View>
        ) : null}

        {needsLink ? (
          <View style={{ marginTop: page === 'join' ? 28 : 8 }}>
            <Field
              testID="space-entry-address" disabled={busy === 'target'} autoFocus={page === 'join'} label={page === 'create' ? 'Owner link' : 'Invite link or address'}
              value={value} onChange={(next) => { setValue(next); setError(''); }} placeholder={page === 'create' ? 'https://…/claim/…' : 'https://your-space.example'} onSubmit={() => void submit()}
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
