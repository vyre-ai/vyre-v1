# mount.file_sent

An edit made in Vyre went out to the provider as a new revision (who made it is in by)

| | |
|---|---|
| Module | mounts |
| Schema version | 1 |
| Subject | folder at /folderId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  mountId: string;
  folderId: string;
  fileId: string;
  name: string;
  revisionId?: string;
  by: string;
};
```
