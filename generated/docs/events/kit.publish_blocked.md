# kit.publish_blocked

A Kit publish failed its tests; the last good version stays live

| | |
|---|---|
| Module | kits |
| Schema version | 1 |
| Subject | kit at /kitId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  kitId: string;
  version: string;
  failures: number;
};
```
