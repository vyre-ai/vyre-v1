# plugin.connection_checked

A connection's health changed

| | |
|---|---|
| Module | agents |
| Schema version | 1 |
| Subject | entity at /connectionId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  connectionId: string;
  name: string;
  health: "ok" | "needs_signin" | "key_refused" | "not_answering" | "needs_setup" | "off" | "unknown";
};
```
