# connection.reconnected

A connection signed in again

| | |
|---|---|
| Module | connectors |
| Schema version | 1 |
| Subject | connection at /connectionId |
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
};
```
