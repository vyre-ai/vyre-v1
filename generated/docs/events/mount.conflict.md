# mount.conflict

A file changed at the provider while an edit in Vyre waited to go out; nothing was overwritten, and the edit waits in Vyre for the person to keep both or use theirs

| | |
|---|---|
| Module | mounts |
| Schema version | 1 |
| Subject | folder at /folderId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | sync.attention |
| Retention | default |

## Payload

```ts
type Payload = {
  mountId: string;
  folderId: string;
  fileId: string;
  name: string;
  keptAs?: string;
};
```
