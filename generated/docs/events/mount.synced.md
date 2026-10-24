# mount.synced

A mount sync pass finished

| | |
|---|---|
| Module | mounts |
| Schema version | 1 |
| Subject | folder at /folderId |
| Visibility | space |
| Label | none |
| Replay | stub |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  mountId: string;
  folderId: string;
  pulled: number;
  pushed: number;
  conflicts: number;
  ms: number;
};
```
