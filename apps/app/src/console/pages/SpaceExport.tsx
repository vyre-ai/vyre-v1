import { useState } from 'react';
import type { ReactElement } from 'react';
import { View } from 'react-native';
import type { CapMap } from '../../../../../generated/types.ts';
import { Group, Section } from '../shell/ui.tsx';
import { useConsoleData } from '../shell/data.tsx';
import { Actions, Button, Download, Note, useAction, useFileDownload } from './shared.tsx';
export function SpaceExport(): ReactElement {
    const data = useConsoleData(), download = useFileDownload(), [review, setReview] = useState(false), [run, setRun] = useState('');
    const action = useAction(() => undefined);
    const read = async (runId: string): Promise<string> => { const ready = await data.call('backup.export_status', { runId }) as CapMap['backup.export_status']['out']; await download.read(ready.fileId); return `Private Space archive is ready. The server copy expires ${new Date(ready.expiresAt).toLocaleString()}.`; };
    return <View testID="console-space-export"><Section title="Space archive"><Group><Note>Includes current shared records and schema, retained file versions, public channel messages and Space settings. Personal files, private and group chats, personal memory and secret values are excluded. The manifest lists every inclusion and exclusion.</Note><Button label="Review Space archive…" disabled={action.busy} onPress={() => setReview(true)}/>{review ? <><Note>Create a private archive for the current Space owner? It remains readable only while you own this Space and retain export permission, and expires after 24 hours.</Note><Actions><Button label="Cancel" onPress={() => setReview(false)}/><Button label="Create Space archive" testID="infra-export-create" disabled={action.busy} onPress={() => void action.run<CapMap['backup.export_start']['out']>('backup.export_start', {}, async (out) => { setRun(out.runId); setReview(false); return read(out.runId); })}/></Actions></> : null}{run ? <Button label="Refresh archive download" disabled={action.busy} onPress={() => void action.run('backup.export_status', { runId: run }, () => read(run))}/> : null}{download.url ? <Download url={download.url} name={download.name} label="Download private Space archive"/> : null}{action.note ? <Note>{action.note}</Note> : null}</Group></Section></View>;
}
