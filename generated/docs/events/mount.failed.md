# mount.failed

A mount sync failed and needs attention

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
  error: string;
};
```
