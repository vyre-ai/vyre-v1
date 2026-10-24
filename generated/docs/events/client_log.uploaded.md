# client_log.uploaded

A device uploaded its ring-buffer log on reconnect

| | |
|---|---|
| Module | logs |
| Schema version | 1 |
| Subject | entity at /device |
| Visibility | owner |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  device: string;
  sizeBytes: number;
};
```
