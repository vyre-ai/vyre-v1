# mount.paused

A mount was paused

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
};
```
